/**
 * IPv4 address helpers for subnet-sweep discovery.
 *
 * Kept separate from index.ts so they can be unit-tested — index.ts calls
 * app.whenReady() at import time and can't be loaded outside Electron.
 */

/**
 * Convert a dotted-quad IPv4 string to an unsigned 32-bit number.
 * Returns -1 for anything that isn't four octets in 0-255.
 */
export function ipToNum(ip: string): number {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => Number.isNaN(p) || p < 0 || p > 255)) return -1;
  return (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0);
}

/** Convert an unsigned 32-bit number back to a dotted-quad IPv4 string. */
export function numToIp(n: number): string {
  return [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF].join('.');
}

/**
 * Convert a dotted-quad netmask to its CIDR prefix length.
 * Returns 0 for a malformed mask, including one whose bits aren't
 * contiguous (e.g. 255.0.255.0) — such a mask can't describe a subnet.
 */
export function netmaskToCidr(mask: string): number {
  const parts = mask.split('.').map(Number);
  if (parts.length !== 4) return 0;
  if (parts.some(p => Number.isNaN(p) || p < 0 || p > 255)) return 0;
  let cidr = 0;
  let done = false;
  for (const p of parts) {
    for (let i = 7; i >= 0; i--) {
      const bit = (p >>> i) & 1;
      if (done && bit) return 0; // Non-contiguous — malformed mask
      if (bit) cidr++;
      else done = true;
    }
  }
  return cidr;
}

/**
 * List every usable host address in the subnet containing `address`,
 * excluding the network and broadcast addresses.
 *
 * Returns [] when the mask is malformed, the prefix falls outside
 * `[minCidr, maxCidr]`, or the host count exceeds `maxHosts` — the sweep
 * caller uses those bounds to avoid probing implausibly large ranges.
 */
export function subnetHosts(
  address: string,
  netmask: string,
  opts: { minCidr?: number; maxCidr?: number; maxHosts?: number } = {},
): string[] {
  const minCidr = opts.minCidr ?? 22;
  const maxCidr = opts.maxCidr ?? 30;
  const maxHosts = opts.maxHosts ?? 1024;

  const cidr = netmaskToCidr(netmask);
  if (cidr < minCidr || cidr > maxCidr) return [];

  const ipNum = ipToNum(address);
  if (ipNum < 0) return [];

  const mask = cidr === 32 ? 0xFFFFFFFF : ((0xFFFFFFFF << (32 - cidr)) >>> 0);
  const network = (ipNum & mask) >>> 0;
  const broadcast = (network | ((~mask) >>> 0)) >>> 0;
  const hostCount = broadcast - network - 1;
  if (hostCount <= 0 || hostCount > maxHosts) return [];

  const hosts: string[] = [];
  for (let i = network + 1; i < broadcast; i++) {
    hosts.push(numToIp(i));
  }
  return hosts;
}

/** True if `ip` falls inside the subnet described by `address`/`netmask`. */
export function isInSubnet(ip: string, address: string, netmask: string): boolean {
  const cidr = netmaskToCidr(netmask);
  if (cidr === 0) return false;
  const target = ipToNum(ip);
  const ifaceNum = ipToNum(address);
  if (target < 0 || ifaceNum < 0) return false;
  const mask = cidr === 32 ? 0xFFFFFFFF : ((0xFFFFFFFF << (32 - cidr)) >>> 0);
  return ((target & mask) >>> 0) === ((ifaceNum & mask) >>> 0);
}
