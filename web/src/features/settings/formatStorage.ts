const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;
const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

/** pt-BR, in whichever unit keeps the number readable: a few attachments are
 * megabytes, and "0,00 GB" made a non-empty quota look empty. */
export function formatStorage(bytes: number): string {
  return bytes >= GB ? `${decimal.format(bytes / GB)} GB` : `${decimal.format(bytes / MB)} MB`;
}
