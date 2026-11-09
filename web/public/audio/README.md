# UI sounds

Short sound effects the app plays for calls, messages and mentions. They are
served as-is from `/audio/<name>.mp3` and wired up in
[`web/src/shared/sounds.ts`](../../src/shared/sounds.ts). All sources are
royalty free (Pixabay Content License or Freesound); check the licence on each
page before replacing or reusing a file.

| File | Plays when | Source |
| --- | --- | --- |
| `call-ringing.mp3` | A DM call is ringing, incoming or outgoing (looped) | [Pixabay](https://pixabay.com/sound-effects/technology-ringtone-089-496413/) |
| `new-message.mp3` | A new message arrives | [Pixabay](https://pixabay.com/sound-effects/film-special-effects-new-notification-014-363678/) |
| `mention.mp3` | You are mentioned | [Pixabay](https://pixabay.com/sound-effects/film-special-effects-new-notification-014-363678/) |
| `unmuted.mp3` | You unmute your microphone | [Freesound, Feraly_](https://freesound.org/people/Feraly_/sounds/836450/) |
| `muted.mp3` | You mute your microphone | [Freesound, Feraly_](https://freesound.org/people/Feraly_/sounds/836449/) |
| `deafened.mp3` | You deafen yourself | `muted.mp3`, 4 semitones lower |
| `undeafened.mp3` | You undeafen yourself | `unmuted.mp3`, 4 semitones higher |
| `incoming-user.mp3` | Someone joins your call | [Freesound, Vsessa](https://freesound.org/people/Vsessa/sounds/866780/) |
| `user-leave.mp3` | Someone leaves your call | [Freesound, Vsessa](https://freesound.org/people/Vsessa/sounds/866780/) |
| `screenshare.mp3` | Someone starts sharing their screen | [Pixabay](https://pixabay.com/sound-effects/technology-deep-ui-chime-585839/) |
| `camera.mp3` | Someone turns their camera on | `screenshare.mp3`, 4 semitones higher |
| `speaker-test.mp3` | The "test" button for the speaker in settings | [Pixabay](https://pixabay.com/sound-effects/technology-ringtone-067-496273/) |

## Editing notes

- The Freesound clips were WAV; they are encoded to MP3 (LAME, VBR `-q:a 2`).
- The pitched variants keep the original duration:

  ```bash
  # <semitones> is -4 or 4; <rate> is the sample rate of the input
  f=$(python3 -c "print(2**(<semitones>/12))")
  ffmpeg -i in.mp3 -af "asetrate=<rate>*$f,aresample=<rate>,atempo=$(python3 -c "print(1/$f)")" \
    -codec:a libmp3lame -qscale:a 2 out.mp3
  ```
- Keep the clips at a similar loudness (mean about -25 dB) so no sound jumps out.
