import { describe, expect, it } from 'vitest';
import { detectPlatform } from '@/lib/pwa/detect';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const MAC_DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36';
const WIN_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

describe('detectPlatform', () => {
  it('iPhone → ios', () => expect(detectPlatform(IPHONE, 5)).toBe('ios'));
  it('iPadOS-as-Mac (touch) → ios', () => expect(detectPlatform(IPAD_AS_MAC, 5)).toBe('ios'));
  it('macOS desktop (no touch) → other', () => expect(detectPlatform(MAC_DESKTOP, 0)).toBe('other'));
  it('Android → android', () => expect(detectPlatform(ANDROID, 5)).toBe('android'));
  it('Windows Chrome → other (no false install prompt)', () =>
    expect(detectPlatform(WIN_CHROME, 0)).toBe('other'));
});
