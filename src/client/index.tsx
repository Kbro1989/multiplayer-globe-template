import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { InterfaceViewport } from "../ui/components/InterfaceViewport";
import { HUD_REGISTRY } from "../ui/HUDRegistry";
import { TelemetryHUD } from "../ui/components/TelemetryHUD";

function Dashboard() {
  const [activeHUDs, setActiveHUDs] = useState<number[]>([1430, 1922]); 

  return (
    <div className="dashboard-root">
      <TelemetryHUD socketUrl="wss://multiplayer-globe-pog2.kristain33rs.workers.dev/parties/globe/pog2-sovereign" />
      <h1>Sovereign 4-Layer Dashboard</h1>
      <div className="viewport-container">
        {activeHUDs.map((id) => (
          <div key={id} className="hud-layer">
            <InterfaceViewport interfaceId={id} />
          </div>
        ))}
      </div>
      <div className="telemetry-panel">
        <h3>Agent Pulse</h3>
        <button 
            onClick={() => {
                window.dispatchEvent(new CustomEvent('TRIGGER_MANIFESTATION', { detail: 'total' }));
            }}
            className="bg-purple-600 hover:bg-purple-500 text-white font-bold py-2 px-4 rounded"
        >
            Reality Refresh
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Dashboard />);
