import { isOwnAvatarUrl } from './avatar-url';

const SUPABASE_URL = 'https://abcd.supabase.co';
const USER = '0b6f1c2e-6f4e-4a8e-9a36-2f8c1d9e7a10';
const OTHER = '9d1e2f3a-4b5c-4d6e-8f70-81a2b3c4d5e6';
const folder = `${SUPABASE_URL}/storage/v1/object/public/avatars`;

describe('isOwnAvatarUrl', () => {
  it("accepts a file in the user's own avatar folder", () => {
    expect(isOwnAvatarUrl(`${folder}/${USER}/face.jpg`, SUPABASE_URL, USER)).toBe(true);
    expect(isOwnAvatarUrl(`${folder}/${USER}/face.jpg?t=1700000000`, SUPABASE_URL, USER)).toBe(
      true,
    );
  });

  it.each([
    ['another user’s folder', `${folder}/${OTHER}/face.jpg`],
    ['the folder itself', `${folder}/${USER}/`],
    ['another bucket', `${SUPABASE_URL}/storage/v1/object/public/uploads/${USER}/face.jpg`],
    [
      'another Supabase project',
      `https://evil.supabase.co/storage/v1/object/public/avatars/${USER}/a.jpg`,
    ],
    ['plain http', `http://abcd.supabase.co/storage/v1/object/public/avatars/${USER}/a.jpg`],
    ['path traversal', `${folder}/${USER}/../${OTHER}/face.jpg`],
    ['encoded path traversal', `${folder}/${USER}/%2e%2e/${OTHER}/face.jpg`],
    ['a third-party host', 'https://tracker.example/pixel.gif'],
    ['not a URL', 'face.jpg'],
  ])('rejects %s', (_label, url) => {
    expect(isOwnAvatarUrl(url, SUPABASE_URL, USER)).toBe(false);
  });
});
