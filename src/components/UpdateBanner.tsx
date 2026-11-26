import type { Updates } from "../updates";

export function UpdateBanner({ updates }: { updates: Updates }) {
  const { state, install, dismiss, visible, currentVersion } = updates;
  if (!visible) return null;

  switch (state.status) {
    case "checking":
      return <div className="update-bar">Checking for updates…</div>;

    case "up-to-date":
      return (
        <div className="update-bar">
          <span>Tidepool {currentVersion} is the latest version.</span>
          <button className="ghost small" onClick={dismiss}>
            OK
          </button>
        </div>
      );

    case "available":
      return (
        <div className="update-bar accent">
          <span>
            <strong>Tidepool {state.version}</strong> is available (you have {currentVersion}).
          </span>
          <span className="grow" />
          <button className="small primary" onClick={install}>
            {state.inApp ? "Install and restart" : "Download"}
          </button>
          <button className="ghost small" onClick={dismiss}>
            Later
          </button>
        </div>
      );

    case "downloading":
      return (
        <div className="update-bar accent">
          <span>
            Downloading Tidepool {state.version}
            {state.percent !== null ? ` — ${state.percent}%` : "…"}
          </span>
          {state.percent !== null && (
            <div className="progress">
              <div style={{ width: `${state.percent}%` }} />
            </div>
          )}
        </div>
      );

    case "error":
      return (
        <div className="update-bar warn">
          <span className="ellipsis">Couldn't check for updates: {state.message}</span>
          <span className="grow" />
          <button className="ghost small" onClick={dismiss}>
            Dismiss
          </button>
        </div>
      );

    default:
      return null;
  }
}
