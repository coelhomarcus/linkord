import { BASE_URL, down } from './stack';

export default async function globalTeardown(): Promise<void> {
  if (process.env.E2E_KEEP_STACK === '1') {
    console.log(`E2E_KEEP_STACK=1: the stack stays up at ${BASE_URL}`);
    return;
  }
  down();
}
