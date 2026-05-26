import { routePartykitRequest, Server } from "partyserver";

import type { OutgoingMessage, Position } from "../shared";
import type { Connection, ConnectionContext } from "partyserver";

// This is the state that we'll store on each connection
type ConnectionState = {
  position: Position;
};

export class Globe extends Server {
  private nodes: Record<string, any> = {};

  async onStart(): Promise<void> {
    // Load persisted nodes from storage
    this.nodes = (await this.ctx.storage.get<Record<string, any>>("nodes")) || {};
    console.log(`🧠 Globe initialized with ${Object.keys(this.nodes).length} persisted nodes.`);
  }

  onConnect(conn: Connection<ConnectionState>, ctx: ConnectionContext) {
    // Whenever a fresh connection is made, we'll
    // send the entire state to the new connection

    // First, let's extract the position from the Cloudflare headers
    const latitude = ctx.request.cf?.latitude as string | undefined;
    const longitude = ctx.request.cf?.longitude as string | undefined;

    // Phase 19: Allow optional position (system nodes)
    const position = (latitude && longitude) ? {
      lat: parseFloat(latitude),
      lng: parseFloat(longitude),
      id: conn.id,
    } : {
      lat: 0,
      lng: 0,
      id: conn.id,
      system: true
    };

    // And save this on the connection's state
    conn.setState({ position });

    // 🧬 Phase 19: Send durable state-sync to the new connection
    conn.send(JSON.stringify({
      type: "state-sync",
      state: {
        id: "pog2-globe-consensus",
        nodes: this.nodes,
        lastSync: Date.now()
      }
    } satisfies OutgoingMessage));

    // Now, let's send markers to the new connection
    for (const connection of this.getConnections<ConnectionState>()) {
      if (connection.state?.position) {
        conn.send(
          JSON.stringify({
            type: "add-marker",
            position: connection.state.position,
          } satisfies OutgoingMessage),
        );

        // And let's send the new connection's position to all other connections
        if (connection.id !== conn.id) {
          connection.send(
            JSON.stringify({
              type: "add-marker",
              position,
            } satisfies OutgoingMessage),
          );
        }
      }
    }
  }

  // Whenever a connection closes (or errors), we'll broadcast a message to all
  // other connections to remove the marker.
  onCloseOrError(connection: Connection) {
    this.broadcast(
      JSON.stringify({
        type: "remove-marker",
        id: connection.id,
      } satisfies OutgoingMessage),
      [connection.id],
    );
  }

  // Phase 17: Sovereign Bidirectional Tail <-|->
  async onMessage(connection: Connection<ConnectionState>, message: string): Promise<void> {
    try {
      const data = JSON.parse(message);

      // 🧬 Phase 19: Handle Telemetry Persistence (the "State map")
      if (data.type === "update-node") {
        this.nodes[data.nodeId] = data.data;
        // Persist to Durable Object storage
        await this.ctx.storage.put("nodes", this.nodes);

        // Broadcast the update to everyone else
        this.broadcast(message, [connection.id]);
        console.log(`📡 Globe State updated and persisted for node: ${data.nodeId}`);
        return;
      }

      // 1. POG2 -> Globe -> Web Clients (The Outward Tail)
      if (data.type === "direct_perception" || data.type === "entity_spawn") {
        this.broadcast(message, [connection.id]);
        return;
      }

      // 2. Web Clients -> Globe -> POG2 (The Inward Tail)
      if (data.type === "volitional_request") {
        this.broadcast(message, [connection.id]);
        return;
      }
    } catch (err) {
      console.error("Failed to parse Globe message:", err);
    }
  }

  /**
   * 🧬 Phase 20: REST Health & Pulse Endpoints (now handled in main fetch)
   * Kept for backward compatibility with direct DO access
   */
  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/health")) {
      return new Response("OK");
    }
    if (url.pathname.endsWith("/pulse")) {
      return Response.json({
        id: "pog2-globe-consensus",
        nodeCount: Object.keys(this.nodes).length,
        nodes: Object.keys(this.nodes),
        lastSync: Date.now()
      });
    }
    return new Response("Not Found", { status: 404 });
  }

  onClose(connection: Connection): void | Promise<void> {
    this.onCloseOrError(connection);
  }

  onError(connection: Connection): void | Promise<void> {
    this.onCloseOrError(connection);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 🧬 Phase 20: Handle health check BEFORE PartyKit routing
    // This fixes the 404 errors seen in Cloudflare logs
    if (url.pathname.endsWith("/health")) {
      return new Response(JSON.stringify({
        status: "healthy",
        timestamp: Date.now(),
        version: "88f9a75e",
        service: "multiplayer-globe-pog2"
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Route to PartyKit/Durable Object
    return (
      (await routePartykitRequest(request, { ...env })) ||
      new Response("Not Found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;