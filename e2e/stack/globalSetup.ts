import { buildHeadImage } from './images';
import { down, up } from './stack';

/** One stack for the whole run, starting on the working tree's build. The
 * `upgrade` project swaps the app to the base version and back itself. */
export default async function globalSetup(): Promise<void> {
  down();
  const image = buildHeadImage();
  await up(image);
}
