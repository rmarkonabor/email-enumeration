'use client';

interface Props {
  rate: number;
  onRateChange: (v: number) => void;
  showPinyin: boolean;
  onTogglePinyin: () => void;
  allVoices: SpeechSynthesisVoice[];
  zhVoices: SpeechSynthesisVoice[];
  chosenVoiceURI: string | null;
  onVoiceChange: (uri: string | null) => void;
}

export default function ControlsBar({
  rate, onRateChange, showPinyin, onTogglePinyin,
  allVoices, zhVoices, chosenVoiceURI, onVoiceChange,
}: Props) {
  return (
    <div className="controls">
      <div className="ctrl-group">
        <label>Speed</label>
        <input
          type="range"
          min="0.4" max="1.1" step="0.05"
          value={rate}
          onChange={e => onRateChange(parseFloat(e.target.value))}
        />
        <span className="speed-val">{rate.toFixed(2)}×</span>
      </div>

      <div className="ctrl-group">
        <label>Voice</label>
        <select value={chosenVoiceURI ?? ''} onChange={e => onVoiceChange(e.target.value || null)}>
          {allVoices.length === 0 ? (
            <option>Loading voices…</option>
          ) : zhVoices.length === 0 ? (
            <>
              <option value="">Auto (let device choose)</option>
              {allVoices.map(v => (
                <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
              ))}
            </>
          ) : (
            zhVoices.map(v => (
              <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
            ))
          )}
        </select>
      </div>

      <div className={`toggle${showPinyin ? ' on' : ''}`} onClick={onTogglePinyin}>
        <span className="switch" />
        <span>Show pinyin</span>
      </div>
    </div>
  );
}
