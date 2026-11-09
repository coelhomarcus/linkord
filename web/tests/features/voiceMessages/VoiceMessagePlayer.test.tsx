import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VoiceMessagePlayer } from '@/features/voiceMessages/VoiceMessagePlayer';
import { encodeWaveform } from '@/features/voiceMessages/voiceFormat';

const waveform = encodeWaveform([0.2, 0.5, 1, 0.4]);

describe('VoiceMessagePlayer', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('shows the recorded duration before anything is loaded, and loads nothing until played', () => {
    render(<VoiceMessagePlayer src="/uploads/v" durationMs={42_000} waveform={waveform} />);
    expect(screen.getByText('0:42')).toBeInTheDocument();
    expect(document.querySelector('audio')).toHaveAttribute('preload', 'none');
    expect(screen.getByRole('slider', { name: 'Posição da mensagem de voz' })).toHaveAttribute('aria-valuetext', '0:00 de 0:42');
  });

  it('play pauses any other voice message that is playing', async () => {
    const user = userEvent.setup();
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async function (this: HTMLMediaElement) {
      Object.defineProperty(this, 'paused', { configurable: true, value: false });
      this.dispatchEvent(new Event('play'));
    });
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
      Object.defineProperty(this, 'paused', { configurable: true, value: true });
      this.dispatchEvent(new Event('pause'));
    });
    render(<><VoiceMessagePlayer src="/uploads/a" durationMs={5_000} waveform={waveform} /><VoiceMessagePlayer src="/uploads/b" durationMs={5_000} waveform={waveform} /></>);
    const [first, second] = screen.getAllByRole('button', { name: 'Reproduzir mensagem de voz' });
    await user.click(first!);
    expect(screen.getByRole('button', { name: 'Pausar mensagem de voz' })).toBeInTheDocument();
    await user.click(second!);
    expect(play).toHaveBeenCalledTimes(2);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('seeks with the arrow keys, 5 seconds at a time, within the duration', () => {
    render(<VoiceMessagePlayer src="/uploads/v" durationMs={12_000} waveform={waveform} />);
    const slider = screen.getByRole('slider', { name: 'Posição da mensagem de voz' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider).toHaveAttribute('aria-valuenow', '5');
    fireEvent.keyDown(slider, { key: 'End' });
    expect(slider).toHaveAttribute('aria-valuenow', '12');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider).toHaveAttribute('aria-valuenow', '12');
    expect(document.querySelector('audio')!.currentTime).toBe(12);
  });

  it('cycles the playback speed', async () => {
    const user = userEvent.setup();
    render(<VoiceMessagePlayer src="/uploads/v" durationMs={12_000} waveform={waveform} />);
    await user.click(screen.getByRole('button', { name: 'Velocidade 1×' }));
    expect(screen.getByRole('button', { name: 'Velocidade 1.5×' })).toBeInTheDocument();
    expect(document.querySelector('audio')!.playbackRate).toBe(1.5);
  });

  it('without a source yet (still uploading) it shows the take but cannot play', () => {
    render(<VoiceMessagePlayer src={null} durationMs={3_000} waveform={waveform} />);
    expect(screen.getByRole('button', { name: 'Reproduzir mensagem de voz' })).toBeDisabled();
    expect(document.querySelector('audio')).toBeNull();
    expect(screen.getByText('0:03')).toBeInTheDocument();
  });

  it('a file that fails to load says so', () => {
    render(<VoiceMessagePlayer src="/uploads/v" durationMs={3_000} waveform={waveform} />);
    fireEvent.error(document.querySelector('audio')!);
    expect(screen.getByRole('img', { name: 'Não foi possível reproduzir este áudio' })).toBeInTheDocument();
  });
});
