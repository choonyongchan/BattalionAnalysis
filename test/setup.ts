/**
 * Test-wide environment, loaded before every suite (`bunfig.toml` preload).
 *
 * `SESSION_SECRET` keys session signatures; production sets its own on Vercel.
 */
process.env.SESSION_SECRET ??= 'test-session-secret';
