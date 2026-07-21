import { ipToNum, numToIp, netmaskToCidr, subnetHosts, isInSubnet } from '../../src/main/net-utils';

describe('ipToNum', () => {
  it('converts the zero address', () => {
    expect(ipToNum('0.0.0.0')).toBe(0);
  });

  it('converts a typical private address', () => {
    expect(ipToNum('192.168.1.1')).toBe(0xC0A80101);
  });

  it('converts the broadcast address without sign overflow', () => {
    // A naive << 24 yields a negative number here; the >>> 0 guards it.
    expect(ipToNum('255.255.255.255')).toBe(4294967295);
  });

  it('converts an address with a high first octet unsigned', () => {
    expect(ipToNum('224.0.0.1')).toBe(3758096385);
    expect(ipToNum('224.0.0.1')).toBeGreaterThan(0);
  });

  it.each([
    ['too few octets', '192.168.1'],
    ['too many octets', '192.168.1.1.1'],
    ['octet above 255', '192.168.1.256'],
    ['negative octet', '192.168.1.-1'],
    ['non-numeric octet', '192.168.1.x'],
    ['empty string', ''],
    ['a hostname', 'mixer.local'],
  ])('returns -1 for %s', (_label, input) => {
    expect(ipToNum(input)).toBe(-1);
  });
});

describe('numToIp', () => {
  it('converts zero', () => {
    expect(numToIp(0)).toBe('0.0.0.0');
  });

  it('converts a typical private address', () => {
    expect(numToIp(0xC0A80101)).toBe('192.168.1.1');
  });

  it('converts the broadcast address', () => {
    expect(numToIp(4294967295)).toBe('255.255.255.255');
  });

  it('round-trips with ipToNum', () => {
    for (const ip of ['10.0.0.1', '172.16.31.254', '192.168.21.41', '255.255.255.0']) {
      expect(numToIp(ipToNum(ip))).toBe(ip);
    }
  });
});

describe('netmaskToCidr', () => {
  it.each([
    ['255.255.255.255', 32],
    ['255.255.255.252', 30],
    ['255.255.255.0', 24],
    ['255.255.254.0', 23],
    ['255.255.252.0', 22],
    ['255.255.0.0', 16],
    ['255.0.0.0', 8],
    ['0.0.0.0', 0],
  ])('maps %s to /%i', (mask, cidr) => {
    expect(netmaskToCidr(mask)).toBe(cidr);
  });

  it('rejects a non-contiguous mask', () => {
    // 255.0.255.0 has a gap — it cannot describe a subnet.
    expect(netmaskToCidr('255.0.255.0')).toBe(0);
  });

  it('rejects a mask with a gap inside one octet', () => {
    expect(netmaskToCidr('255.255.255.5')).toBe(0);
  });

  it.each([
    ['too few octets', '255.255.255'],
    ['octet above 255', '255.255.255.999'],
    ['non-numeric octet', '255.255.255.x'],
  ])('returns 0 for %s', (_label, mask) => {
    expect(netmaskToCidr(mask)).toBe(0);
  });
});

describe('subnetHosts', () => {
  it('lists all usable hosts on a /30, excluding network and broadcast', () => {
    // 10.0.0.0/30: network .0, hosts .1 .2, broadcast .3
    expect(subnetHosts('10.0.0.1', '255.255.255.252')).toEqual(['10.0.0.1', '10.0.0.2']);
  });

  it('yields 254 hosts for a /24', () => {
    const hosts = subnetHosts('192.168.1.50', '255.255.255.0');
    expect(hosts).toHaveLength(254);
    expect(hosts[0]).toBe('192.168.1.1');
    expect(hosts[253]).toBe('192.168.1.254');
  });

  it('excludes the network and broadcast addresses', () => {
    const hosts = subnetHosts('192.168.1.50', '255.255.255.0');
    expect(hosts).not.toContain('192.168.1.0');
    expect(hosts).not.toContain('192.168.1.255');
  });

  it('derives the same host list regardless of which address in the subnet is given', () => {
    const fromLow = subnetHosts('192.168.1.1', '255.255.255.0');
    const fromHigh = subnetHosts('192.168.1.254', '255.255.255.0');
    expect(fromLow).toEqual(fromHigh);
  });

  it('spans octet boundaries on a /22', () => {
    const hosts = subnetHosts('10.0.4.5', '255.255.252.0');
    expect(hosts).toHaveLength(1022);
    expect(hosts[0]).toBe('10.0.4.1');
    expect(hosts).toContain('10.0.5.1');
    expect(hosts[hosts.length - 1]).toBe('10.0.7.254');
  });

  // ---- Safety bounds: the sweep must not probe implausibly large ranges ----
  it('returns [] for a prefix wider than the default /22 floor', () => {
    expect(subnetHosts('10.0.0.1', '255.255.0.0')).toEqual([]);
  });

  it('returns [] for a /31, which has no usable hosts', () => {
    expect(subnetHosts('10.0.0.1', '255.255.255.254')).toEqual([]);
  });

  it('returns [] for a /32', () => {
    expect(subnetHosts('10.0.0.1', '255.255.255.255')).toEqual([]);
  });

  it('returns [] when the host count exceeds maxHosts', () => {
    expect(subnetHosts('192.168.1.1', '255.255.255.0', { maxHosts: 10 })).toEqual([]);
  });

  it('honours a widened minCidr', () => {
    const hosts = subnetHosts('10.0.0.1', '255.255.0.0', { minCidr: 16, maxHosts: 100000 });
    expect(hosts).toHaveLength(65534);
  });

  it('returns [] for a malformed netmask', () => {
    expect(subnetHosts('10.0.0.1', '255.0.255.0')).toEqual([]);
  });

  it('returns [] for a malformed address', () => {
    expect(subnetHosts('not-an-ip', '255.255.255.0')).toEqual([]);
  });
});

describe('isInSubnet', () => {
  it('accepts an address inside a /24', () => {
    expect(isInSubnet('192.168.1.99', '192.168.1.1', '255.255.255.0')).toBe(true);
  });

  it('rejects an address outside a /24', () => {
    expect(isInSubnet('192.168.2.99', '192.168.1.1', '255.255.255.0')).toBe(false);
  });

  it('accepts an address that shares a /22 but not a /24', () => {
    // The sweep prioritises the interface holding the saved mixer IP, so a
    // wider prefix has to match even when the third octet differs.
    expect(isInSubnet('10.0.6.20', '10.0.4.5', '255.255.252.0')).toBe(true);
  });

  it('rejects an address just outside a /22', () => {
    expect(isInSubnet('10.0.8.1', '10.0.4.5', '255.255.252.0')).toBe(false);
  });

  it('treats the network and broadcast addresses as inside', () => {
    expect(isInSubnet('192.168.1.0', '192.168.1.1', '255.255.255.0')).toBe(true);
    expect(isInSubnet('192.168.1.255', '192.168.1.1', '255.255.255.0')).toBe(true);
  });

  it('returns false for a malformed netmask', () => {
    expect(isInSubnet('192.168.1.1', '192.168.1.1', '255.0.255.0')).toBe(false);
  });

  it('returns false for a malformed target address', () => {
    expect(isInSubnet('nope', '192.168.1.1', '255.255.255.0')).toBe(false);
  });
});
