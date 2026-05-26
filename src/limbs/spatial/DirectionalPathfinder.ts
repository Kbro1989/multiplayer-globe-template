import { BinaryHeap, Comparable } from '../../utils/BinaryHeap.js';
import { Coord, Direction, DirectionalCollision, GameState } from '../../core/models.js';
import { createLogger } from '../../utils/logger.js';
import { SpatialSovereigntyLimb } from './SpatialSovereigntyLimb.js';
import { PlaneTransitionRegistry } from './PlaneTransitionRegistry.js';

const logger = createLogger('DirectionalPathfinder');

class PathNode implements Comparable<PathNode> {
    public x: number;
    public y: number;
    public plane: number;
    public gScore: number;
    public fScore: number;
    public parent?: PathNode;

    constructor(coord: Coord, gScore: number, fScore: number, parent?: PathNode) {
        this.x = coord.x;
        this.y = coord.y;
        this.plane = coord.plane;
        this.gScore = gScore;
        this.fScore = fScore;
        this.parent = parent;
    }

    compare(other: PathNode): number {
        // Min-heap: lower fScore = higher priority
        return this.fScore - other.fScore;
    }

    toCoord(): Coord {
        return { x: this.x, y: this.y, plane: this.plane };
    }

    get key(): string {
        return `${this.plane}_${this.x}_${this.y}`;
    }
}

/**
 * DirectionalPathfinder - The "Motor" of the Sovereign Organism.
 * Implements Quaternary A* incorporating Directional Collision.
 */
export class DirectionalPathfinder {

    constructor(private spatial: SpatialSovereigntyLimb) {
    }

    /**
     * findPath - Quaternary A* for worker environments.
     */
    public findPath(
        start: Coord,
        end: Coord,
        gameState?: GameState,
        isPlayer = true,
        debug = false
    ): Coord[] {
        const npcIndex = gameState?.npcSpatialIndex;
        const openSet = new BinaryHeap<PathNode>();
        const closedSet = new Set<string>();
        const gScores = new Map<string, number>();

        const startNode = new PathNode(
            start,
            0,
            this.heuristic(start, end)
        );

        openSet.insert(startNode);
        gScores.set(startNode.key, 0);

        let iterations = 0;
        const MAX_ITERATIONS = Math.max(5000, Math.floor(this.heuristic(start, end) * 100));

        while (!openSet.isEmpty() && iterations < MAX_ITERATIONS) {
            iterations++;
            const current = openSet.pop()!;

            if (current.x === end.x && current.y === end.y) {
                if (debug) logger.info(`Path found in ${iterations} iterations.`);
                return this.reconstructPath(current);
            }

            closedSet.add(current.key);

            // Expand Neighbors
            const neighbors = this.getNeighbors(current);
            for (const { coord: next, direction } of neighbors) {
                const nKey = `${next.plane}_${next.x}_${next.y}`;

                if (closedSet.has(nKey)) continue;

                // THE SOVEREIGN RULE: Verify Directional Collision
                const canMove = this.canMove(current.toCoord(), next, direction, npcIndex, isPlayer);
                if (!canMove) continue;

                const tentativeG = current.gScore + 1;
                const existingG = gScores.get(nKey) ?? Infinity;

                if (tentativeG < existingG) {
                    const nextNode = new PathNode(
                        next,
                        tentativeG,
                        tentativeG + this.heuristic(next, end),
                        current
                    );
                    gScores.set(nKey, tentativeG);
                    openSet.insert(nextNode);
                }
            }
        }

        if (debug) logger.warn(`No path found after ${iterations} iterations.`);
        return [];
    }

    /**
     * canMove - THE SOVEREIGN NAVIGATION RULE:
     * A move from (from) to (to) is valid ONLY if:
     * 1. (from) does not block exit in DIRECTION.
     * 2. (to) does not block entry in REVERSE_DIRECTION.
     * 3. Diagonals strictly forbid corner-cutting if adjacent cardinals are blocked.
     */
    public canMove(
        from: Coord,
        to: Coord,
        direction: Direction,
        npcIndex?: Map<string, any[]>,
        isPlayer = true
    ): boolean {
        // Target tile must be structurally walkable
        // Exception: 'up' / 'down' are portal transitions — bypass collision entirely
        if (direction === 'up' || direction === 'down') {
            const registry = PlaneTransitionRegistry.getInstance();
            const link = registry.getLink(from);
            return link !== null &&
                   link.to.x === to.x &&
                   link.to.y === to.y &&
                   link.to.plane === to.plane;
        }

        if (!this.isWalkable(to.plane, to.x, to.y)) {
            return false;
        }

        // --- DYNAMIC OBSTACLE CHECK (Phase 43) ---
        if (npcIndex) {
            const key = `${to.x},${to.y},${to.plane}`;
            const npcs = npcIndex.get(key);
            if (npcs && npcs.length > 0) {
                // If any NPC on the tile blocks movement
                return false;
            }
        }

        // --- DIAGONAL CLIP RULE ---
        if (direction === 'north-east' || direction === 'north-west' || direction === 'south-east' || direction === 'south-west') {
            // Unpack direction
            const isNorth = direction.includes('north');
            const isSouth = direction.includes('south');
            const isEast = direction.includes('east');
            const isWest = direction.includes('west');

            // Find orthogonal neighbors
            const orth1X = isEast ? from.x + 1 : (isWest ? from.x - 1 : from.x);
            const orth1Y = from.y; // Horizontal adj
            const orth2X = from.x;
            const orth2Y = isNorth ? from.y + 1 : (isSouth ? from.y - 1 : from.y); // Vertical adj

            // 1. Orthogonal tiles must be structurally walkable (no corner cutting across solids)
            if (!this.isWalkable(from.plane, orth1X, orth1Y)) return false;
            if (!this.isWalkable(from.plane, orth2X, orth2Y)) return false;

            // 2. Both current and target tiles must permit orthogonal transit within the diagonal envelope
            if (isNorth) { if (!this.canTransit(from, to, 'north', isPlayer)) return false; }
            if (isSouth) { if (!this.canTransit(from, to, 'south', isPlayer)) return false; }
            if (isEast)  { if (!this.canTransit(from, to, 'east', isPlayer)) return false; }
            if (isWest)  { if (!this.canTransit(from, to, 'west', isPlayer)) return false; }

            return true;
        }

        // --- CARDINAL CHECK ---
        return this.canTransit(from, to, direction, isPlayer);
    }

    /**
     * Helper to verify if transit across an exact cardinal edge is permitted safely.
     */
    private canTransit(from: Coord, to: Coord, direction: Direction, isPlayer = true): boolean {
        const fromLogic = this.spatial.getLogicAt(from.plane, from.x, from.y);
        const toLogic = this.spatial.getLogicAt(to.plane, to.x, to.y);

        if (fromLogic === null || toLogic === null) return false;

        // 1. From Tile Edge Blocking
        if (typeof fromLogic === 'object') {
            const c = fromLogic as any;
            if (!isPlayer && c.npc_only_blocks?.includes(direction)) return false;

            if (c.edges) {
                const edges = c.edges;
                if (direction === 'north' && edges.northBlocked) return false;
                if (direction === 'south' && edges.southBlocked) return false;
                if (direction === 'east' && edges.eastBlocked) return false;
                if (direction === 'west' && edges.westBlocked) return false;
            } else if (direction in c) {
                if (c[direction] === false) return false;
            }
        }

        // 2. To Tile Edge Blocking
        const reverseDir = this.getReverseDirection(direction);
        if (typeof toLogic === 'object') {
            const c = toLogic as any;
            if (!isPlayer && c.npc_only_blocks?.includes(reverseDir)) return false;

            if (c.edges) {
                const edges = c.edges;
                if (reverseDir === 'north' && edges.northBlocked) return false;
                if (reverseDir === 'south' && edges.southBlocked) return false;
                if (reverseDir === 'east' && edges.eastBlocked) return false;
                if (reverseDir === 'west' && edges.westBlocked) return false;
            } else if (reverseDir in c) {
                if (c[reverseDir] === false) return false;
            }
        }

        // Legacy compat (0x100 overlay block etc)
        if (typeof toLogic === 'number' && (toLogic & 0x100)) return false;

        return true;
    }

    /**
     * isWalkable - Phase C3: Deterministic Cross-Region Check.
     * Delegates directly to SpatialSovereigntyLimb which uses bounds-based
     * matrix resolution (findMatrixForCoords). The old SpaceRegistry name gate
     * caused false-positives when registry names didn't match loaded matrix names.
     */
    private isWalkable(p: number, x: number, z: number): boolean {
        // Direct delegation — SpatialSovereigntyLimb.isWalkable already handles:
        // 1. GAL override check
        // 2. Bounds-based matrix lookup (findMatrixForCoords)
        // 3. Legacy surface stack fallback
        // If no matrix covers this tile, it falls through to surface stack,
        // which defaults walkable=true (No-Man's-Land equivalent).
        return this.spatial.isWalkable(p, x, z);
    }

    private heuristic(a: Coord, b: Coord): number {
        // Chebyshev distance for uniform diagonal cost, slightly scaled to prefer direct routes
        const dx = Math.abs(a.x - b.x);
        const dy = Math.abs(a.y - b.y);
        const dp = Math.abs(a.plane - b.plane);
        return (Math.max(dx, dy) + (dp * 10)) * 1.01;
    }

    private getNeighbors(node: PathNode): { coord: Coord; direction: Direction }[] {
        const neighbors: { coord: Coord; direction: Direction }[] = [
            { coord: { x: node.x, y: node.y + 1, plane: node.plane }, direction: 'north' },
            { coord: { x: node.x, y: node.y - 1, plane: node.plane }, direction: 'south' },
            { coord: { x: node.x + 1, y: node.y, plane: node.plane }, direction: 'east' },
            { coord: { x: node.x - 1, y: node.y, plane: node.plane }, direction: 'west' },
            { coord: { x: node.x + 1, y: node.y + 1, plane: node.plane }, direction: 'north-east' },
            { coord: { x: node.x - 1, y: node.y + 1, plane: node.plane }, direction: 'north-west' },
            { coord: { x: node.x + 1, y: node.y - 1, plane: node.plane }, direction: 'south-east' },
            { coord: { x: node.x - 1, y: node.y - 1, plane: node.plane }, direction: 'south-west' }
        ];

        // ── Vertical Plane Transitions ────────────────────────────────────────
        const link = PlaneTransitionRegistry.getInstance().getLink(node.toCoord());
        if (link) {
            const dir: Direction = link.to.plane > node.plane ? 'up' : 'down';
            neighbors.push({ coord: link.to, direction: dir });
        }

        return neighbors;
    }

    private getReverseDirection(dir: Direction): Direction {
        const map: Record<Direction, Direction> = {
            north: 'south',
            south: 'north',
            east: 'west',
            west: 'east',
            'north-east': 'south-west',
            'south-west': 'north-east',
            'north-west': 'south-east',
            'south-east': 'north-west',
            up: 'down',
            down: 'up'
        };
        return map[dir];
    }

    private reconstructPath(node: PathNode): Coord[] {
        const path: Coord[] = [];
        let curr: PathNode | undefined = node;
        while (curr) {
            path.unshift(curr.toCoord());
            curr = curr.parent;
        }
        return path;
    }

    public handleMinimapClick(start: Coord, end: Coord, state: GameState): Coord[] {
        logger.info({ start, end }, '[DirectionalPathfinder] Minimap click handler invoked.');
        return this.findPath(start, end, state);
    }
}

