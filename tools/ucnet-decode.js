/**
 * Decode UCNet traffic from a pcap.
 *
 * Several things this project needs are not in the protocol library and not
 * guessable from Universal Control's binary: how a document is transferred on
 * and off the console, and what command deletes a stored preset. Both exist in
 * UC's UI (`sendToDisk`, `sendToMixer`, `removePreset`) and neither appears as a
 * command id in its string table, so the only way to learn them is to watch UC
 * do it.
 *
 *   sudo tcpdump -i en0 -s0 -w uc.pcap 'host 192.168.21.41 and tcp port 53000'
 *   node tools/ucnet-decode.js uc.pcap
 *   node tools/ucnet-decode.js uc.pcap --json     every JM payload in full
 *   node tools/ucnet-decode.js uc.pcap --code FR  only that message code
 *
 * Capture only the console's own control port. The point is the protocol, and a
 * wider filter would collect unrelated traffic from the machine.
 *
 * Reads the pcap itself rather than shelling out to `tcpdump -X` and scraping
 * hex, because the stream has to be reassembled per direction before UCNet
 * frames can be found at all: a packet may span segments and a segment may hold
 * several packets. That is the same reassembly the client does, and getting it
 * wrong is what made the library drop packets (see
 * docs/config-backup-restore-plan.md §4.1).
 */

const fs = require('fs');
const zlib = require('zlib');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};

if (!file) {
  console.error('usage: node tools/ucnet-decode.js <capture.pcap> [--json] [--code XX] [--hex]');
  process.exit(2);
}

const HEADER = Buffer.from([0x55, 0x43, 0x00, 0x01]);
const LINKTYPE_EN10MB = 1;
const LINKTYPE_NULL = 0;
const LINKTYPE_LOOP = 108;

// ─── pcap ──────────────────────────────────────────────────────────────────

function readPcap(buf) {
  if (buf.length < 24) throw new Error('file is too small to be a pcap');
  const magic = buf.readUInt32LE(0);
  let le;
  if (magic === 0xa1b2c3d4 || magic === 0xa1b23c4d) le = true;
  else if (magic === 0xd4c3b2a1 || magic === 0x4d3cb2a1) le = false;
  else if (buf.readUInt32BE(0) === 0x0a0d0d0a) {
    throw new Error('this is a pcapng file; capture with `tcpdump -w` for classic pcap');
  } else {
    throw new Error(`unrecognised pcap magic 0x${magic.toString(16)}`);
  }
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const linkType = u32(20);

  const packets = [];
  let off = 24;
  while (off + 16 <= buf.length) {
    const tsSec = u32(off);
    const tsUsec = u32(off + 4);
    const inclLen = u32(off + 8);
    if (inclLen > buf.length - off - 16) break; // truncated final record
    packets.push({
      time: tsSec * 1000 + Math.floor(tsUsec / 1000),
      data: buf.subarray(off + 16, off + 16 + inclLen),
    });
    off += 16 + inclLen;
  }
  return { linkType, packets };
}

/** Strip link, IP and TCP headers. Returns null for anything that is not TCP. */
function tcpPayload(frame, linkType) {
  let off;
  if (linkType === LINKTYPE_EN10MB) {
    if (frame.length < 14) return null;
    let etherType = frame.readUInt16BE(12);
    off = 14;
    // Hop over VLAN tags.
    while (etherType === 0x8100 || etherType === 0x88a8) {
      if (frame.length < off + 4) return null;
      etherType = frame.readUInt16BE(off + 2);
      off += 4;
    }
    if (etherType !== 0x0800) return null; // IPv4 only
  } else if (linkType === LINKTYPE_NULL || linkType === LINKTYPE_LOOP) {
    off = 4;
  } else {
    throw new Error(`unsupported pcap link type ${linkType}`);
  }

  if (frame.length < off + 20) return null;
  const ihl = (frame[off] & 0x0f) * 4;
  if ((frame[off] >> 4) !== 4) return null;
  const protocol = frame[off + 9];
  if (protocol !== 6) return null; // TCP
  const totalLength = frame.readUInt16BE(off + 2);
  const srcIp = [...frame.subarray(off + 12, off + 16)].join('.');
  const dstIp = [...frame.subarray(off + 16, off + 20)].join('.');

  const tcpOff = off + ihl;
  if (frame.length < tcpOff + 20) return null;
  const srcPort = frame.readUInt16BE(tcpOff);
  const dstPort = frame.readUInt16BE(tcpOff + 2);
  const dataOff = ((frame[tcpOff + 12] >> 4) & 0x0f) * 4;
  const payloadStart = tcpOff + dataOff;
  // Prefer the IP total length: the captured frame may carry ethernet padding.
  const payloadEnd = Math.min(frame.length, off + totalLength);
  if (payloadEnd <= payloadStart) return null;

  return {
    key: `${srcIp}:${srcPort}->${dstIp}:${dstPort}`,
    srcIp, srcPort, dstIp, dstPort,
    payload: frame.subarray(payloadStart, payloadEnd),
  };
}

// ─── UCNet framing ─────────────────────────────────────────────────────────

/**
 * Frame one direction's byte stream. Mirrors the fixed client reframer: carry
 * incomplete bytes rather than discarding them, and resynchronise on the next
 * header when the stream goes out of step.
 */
function makeFramer(onPacket) {
  let buffer = Buffer.alloc(0);
  return (bytes, time) => {
    buffer = buffer.length === 0 ? Buffer.from(bytes) : Buffer.concat([buffer, bytes]);
    for (;;) {
      if (buffer.length < 6) return;
      if (HEADER.compare(buffer, 0, 4) !== 0) {
        let next = -1;
        for (let i = 1; i + 4 <= buffer.length; i++) {
          if (HEADER.compare(buffer, i, i + 4) === 0) { next = i; break; }
        }
        if (next === -1) { buffer = buffer.subarray(Math.max(0, buffer.length - 3)); return; }
        buffer = buffer.subarray(next);
        continue;
      }
      const length = buffer.readUInt16LE(4);
      if (buffer.length < 6 + length) return;
      onPacket(buffer.subarray(0, 6 + length), time);
      buffer = buffer.subarray(6 + length);
    }
  };
}

// ─── Reporting ─────────────────────────────────────────────────────────────

const codeFilter = opt('code');
const counts = new Map();
let t0 = null;
const ckChunks = new Map();

function describe(packet, time, direction) {
  const code = packet.subarray(6, 8).toString('latin1');
  counts.set(code, (counts.get(code) || 0) + 1);
  if (codeFilter && code !== codeFilter) return;

  if (t0 === null) t0 = time;
  const stamp = `[${String(time - t0).padStart(6)}ms]`;
  const arrow = direction === 'out' ? '-->' : '<--';
  const payload = packet.subarray(12);

  // PV/PS/PC are high-volume parameter chatter; one line each is enough, and
  // only when they are what was asked for.
  if (code === 'PV' || code === 'PS' || code === 'PC' || code === 'MS' || code === 'KA') {
    if (codeFilter) {
      const nul = payload.indexOf(0);
      const name = nul > 0 ? payload.subarray(0, nul).toString() : '';
      console.log(`${stamp} ${arrow} ${code} ${name}`);
    }
    return;
  }

  if (code === 'JM') {
    let json;
    try {
      json = JSON.parse(payload.subarray(4).toString().replace(/\0+$/, ''));
    } catch {
      console.log(`${stamp} ${arrow} JM (unparsed, ${payload.length} bytes)`);
      return;
    }
    const { id, ...rest } = json;
    console.log(`${stamp} ${arrow} JM ${id}`);
    if (Object.keys(rest).length) {
      console.log(flag('json')
        ? `           ${JSON.stringify(json, null, 2).split('\n').join('\n           ')}`
        : `           ${JSON.stringify(rest)}`);
    }
    return;
  }

  // FR is the file-request channel: id(2 BE) then a 4-character verb then a
  // path. The verb set is the thing worth learning — only "List" and "Ftbr" are
  // known, and neither covers transferring or deleting a document.
  if (code === 'FR') {
    const id = payload.length >= 2 ? payload.readUInt16BE(0) : -1;
    const rest = payload.subarray(2);
    const verb = rest.subarray(0, 4).toString('latin1');
    const path = rest.subarray(4).toString('latin1').replace(/\0+$/, '');
    console.log(`${stamp} ${arrow} FR id=${id} verb=${JSON.stringify(verb)} path=${JSON.stringify(path)}`);
    if (flag('hex')) console.log(`           ${payload.subarray(0, 64).toString('hex')}`);
    return;
  }

  if (code === 'FD') {
    // 14-byte header, then the chunk. Sizes are read both ways because the
    // library's UInt16 reading is suspected wrong for real payloads.
    const h = payload;
    const id = h.readUInt16BE(0);
    const bytesRead16 = h.readUInt16LE(2);
    const totalSize16 = h.readUInt16LE(6);
    const payloadSize16 = h.readUInt16LE(12);
    const bytesRead32 = h.readUInt32LE(2);
    const totalSize32 = h.readUInt32LE(6);
    const body = h.subarray(14);
    console.log(`${stamp} ${arrow} FD id=${id} body=${body.length}` +
      `  u16{read:${bytesRead16} total:${totalSize16} size:${payloadSize16}}` +
      `  u32{read:${bytesRead32} total:${totalSize32}}`);
    const text = body.subarray(0, 48).toString('latin1').replace(/[^\x20-\x7e]/g, '.');
    console.log(`           first bytes: ${text}`);
    return;
  }

  if (code === 'CK' || code === 'ZB') {
    const b = code === 'CK' ? payload.subarray(4) : payload.subarray(4);
    if (code === 'CK' && b.length >= 12) {
      const chunkOffset = b.readUInt32LE(0);
      const total = b.readUInt32LE(4);
      const size = b.readUInt32LE(8);
      const key = `${direction}`;
      const acc = ckChunks.get(key) || [];
      acc.push(b.subarray(12));
      ckChunks.set(key, acc);
      const have = acc.reduce((n, c) => n + c.length, 0);
      const final = chunkOffset + size === total;
      console.log(`${stamp} ${arrow} CK offset=${chunkOffset} size=${size} total=${total} have=${have}${final ? '  FINAL' : ''}`);
      if (final) {
        try {
          const inflated = zlib.inflateSync(Buffer.concat(acc));
          console.log(`           inflates to ${inflated.length} bytes`);
        } catch (err) {
          console.log(`           inflate failed: ${err.message}`);
        }
        ckChunks.set(key, []);
      }
    } else {
      console.log(`${stamp} ${arrow} ${code} ${payload.length} bytes`);
    }
    return;
  }

  console.log(`${stamp} ${arrow} ${code} ${payload.length} bytes` +
    (flag('hex') ? `  ${payload.subarray(0, 48).toString('hex')}` : ''));
}

// ─── Main ──────────────────────────────────────────────────────────────────

const { linkType, packets } = readPcap(fs.readFileSync(file));
console.log(`pcap: ${packets.length} frames, link type ${linkType}\n`);

const framers = new Map();
// The console's control port decides direction, whichever side it is on.
const CONSOLE_PORT = 53000;

for (const { time, data } of packets) {
  let seg;
  try { seg = tcpPayload(data, linkType); } catch (err) { console.error(err.message); process.exit(1); }
  if (!seg || seg.payload.length === 0) continue;

  const direction = seg.dstPort === CONSOLE_PORT ? 'out' : 'in';
  let framer = framers.get(seg.key);
  if (!framer) {
    framer = makeFramer((packet, t) => describe(packet, t, direction));
    framers.set(seg.key, framer);
  }
  framer(seg.payload, time);
}

console.log('\n=== message code counts ===');
for (const [code, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${code}  ${n}`);
}
