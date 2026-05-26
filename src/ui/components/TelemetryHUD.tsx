import React, { useState, useEffect } from 'react';

export const TelemetryHUD = ({ socketUrl }: { socketUrl: string }) => {
  const [coords, setCoords] = useState({ x: 0, y: 0, z: 0, plane: 0 });

  useEffect(() => {
    const ws = new WebSocket(socketUrl);
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        // Assuming your bridge broadcasts the position update
        if (data.type === 'state-sync' || data.type === 'update-node') {
          // You may need to adapt this based on the specific event shape
          const pos = data.state?.position || data.data?.position;
          if (pos) {
            setCoords({ x: pos.x, y: pos.y, z: pos.z || 0, plane: pos.plane || 0 });
          }
        }
      } catch (e) {
        console.error("Telemetry parse error", e);
      }
    };

    return () => ws.close();
  }, [socketUrl]);

  return (
    <div className="absolute top-4 right-4 bg-black/80 text-green-400 p-4 border border-green-500/30 rounded font-mono text-sm z-50">
      <div>X: {coords.x}</div>
      <div>Y: {coords.y}</div>
      <div>Plane: {coords.plane}</div>
      <div className="text-xs text-green-600 mt-1">Grounding: Engine Grid</div>
    </div>
  );
};
