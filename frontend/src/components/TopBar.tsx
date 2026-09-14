import { SONGS } from "../data/songs";
import { useStore } from "../state/store";

export function TopBar() {
  const songId = useStore((s) => s.songId);
  const setSong = useStore((s) => s.setSong);
  const song = SONGS.find((s) => s.id === songId) ?? SONGS[0];
  const recording = useStore((s) => s.recording);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo">🎶</span>
        <div>
          <h1>LetsSing<span className="ai">AI</span></h1>
          <p className="tagline">You sing · a Strands agent runs the lesson</p>
        </div>
      </div>
      <div className="song-pill">
        <span className="song-label">Phrase</span>
        <select
          className="song-select"
          value={song.id}
          disabled={recording}
          onChange={(e) => setSong(e.target.value)}
          aria-label="Reference phrase"
        >
          {SONGS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        <span className="song-artist">{song.artist}</span>
      </div>
    </header>
  );
}
