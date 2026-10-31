import { describe, expect, it } from 'vitest';
import { presentFile, splitFileName } from '@/features/media/filePresentation';

describe('splitFileName', () => {
  it('splits on the last dot, keeping a compound extension and a dotfile whole', () => {
    expect(splitFileName('relatorio.pdf')).toEqual({ baseName: 'relatorio', extension: 'pdf' });
    expect(splitFileName('backup.tar.gz')).toEqual({ baseName: 'backup', extension: 'tar.gz' });
    expect(splitFileName('README')).toEqual({ baseName: 'README', extension: '' });
    expect(splitFileName('.env')).toEqual({ baseName: '.env', extension: '' });
    expect(splitFileName('')).toEqual({ baseName: '', extension: '' });
    expect(splitFileName('café com açúcar.docx')).toEqual({ baseName: 'café com açúcar', extension: 'docx' });
  });
});

describe('presentFile', () => {
  it('lets a specific MIME win, and falls back to the extension otherwise', () => {
    expect(presentFile('relatorio.txt', 'application/pdf').family).toBe('pdf');
    expect(presentFile('notas.md', 'text/markdown; charset=utf-8').family).toBe('text-code');
    expect(presentFile('planilha.xlsx', 'application/octet-stream').family).toBe('spreadsheet');
    expect(presentFile('projeto.zip', '').family).toBe('archive');
    expect(presentFile('CONTRATO.PDF', 'application/octet-stream').family).toBe('pdf');
    expect(presentFile('dump.tar.gz', 'application/octet-stream').family).toBe('archive');
    expect(presentFile('vazio.csv', 'text/csv').family).toBe('spreadsheet');
    expect(presentFile('foto.tiff', 'image/tiff').family).toBe('image');
    expect(presentFile('som.flac', 'audio/flac').family).toBe('audio');
    expect(presentFile('filme.mkv', 'video/x-matroska').family).toBe('video');

    const unknown = presentFile('README', 'application/x-something-weird');
    expect(unknown.family).toBe('unknown');
    expect(unknown.typeLabel).toBe('Arquivo');
  });

  it('a name that disagrees with the MIME only changes the identity, never a preview', () => {
    const presented = presentFile('pagina.html', 'application/octet-stream');
    expect(presented.family).toBe('text-code');
    expect(presented.baseName).toBe('pagina');
    expect(presented.extension).toBe('html');
  });
});
