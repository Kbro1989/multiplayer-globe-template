import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { InterfaceViewport } from "../ui/components/InterfaceViewport";
import { HUD_REGISTRY } from "../../src/ui/HUDRegistry";

function Dashboard() {
  const [activeHUDs, setActiveHUDs] = useState<number[]>([1430, 1922]); // Default HUDs (Action Bar, Nav)
  const [nodes, setNodes] = useState<Record<string, any>>({});

  // Establish MCP/WebSocket bridge here
  useEffect(() => {
    // In a full implementation, you would connect to the POG2 WebSocket bridge
    console.log("🧬 POG2 Dashboard Initialized. Connecting to Sovereignty stream...");
  }, []);

  return (
    <div className="dashboard-root">
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
        {/* Render telemetry nodes */}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Dashboard />);
