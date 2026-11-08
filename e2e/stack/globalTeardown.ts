import { down } from './stack';

export default async function globalTeardown(): Promise<void> {
  if (process.env.E2E_KEEP_STACK === '1') {
    console.log('E2E_KEEP_STACK=1: the stack stays up at http://localhost:8080');
    return;
  }
  down();
}
