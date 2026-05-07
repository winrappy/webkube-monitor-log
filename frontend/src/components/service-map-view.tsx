"use client";

import { useMemo, useState } from "react";
import type { NodePosition, ServiceMap, ServiceMapEdge, ServiceMapNode } from "@/types/monitor";

// ─── Cascade Risk ─────────────────────────────────────────────────────────────
//
// TODO: Implement this function.
//
// Context: edges represent traffic/dependency flow — `source` sends requests TO `target`.
// So if `target` fails, `source` may cascade-fail too.
//
// When a user hovers a node, we want to highlight which upstream nodes are at risk
// if that hovered node were to fail.
//
// Return: a Set of node IDs that are at cascade risk given `targetId` is failing.
//
// Trade-offs to consider:
//   - Direct only: only nodes with an edge pointing directly at targetId
//   - Transitive: walk the full reverse graph (BFS/DFS) — shows full blast radius
//   - Both are valid — transitive is more useful for deep service chains
//
// Signature and location are fixed; implement the body (5–10 lines).
//
function computeCascadeRisk(
  targetId: string | null,
  edges: ServiceMapEdge[]
): Set<string> {
  if (!targetId) return new Set();

  // TODO: implement cascade risk detection here
  // Hint: an edge { source, target } means "source depends on target"
  // If targetId fails, which sources are at risk? (and their sources? etc.)
  return new Set<string>();
}
// ──────────────────────────────────────────────────────────────────────────────

const NODE_W = 160;
const NODE_H = 56;
const LAYER_GAP = 160;
const NODE_GAP = 28;
const CANVAS_PAD = 48;

const HEALTH_FILL: Record<string, string> = {
  healthy: "rgba(70,240,194,0.12)",
  degraded: "rgba(255,200,60,0.14)",
  failing: "rgba(255,80,80,0.16)",
  unknown: "rgba(155,176,194,0.10)",
};

const HEALTH_STROKE: Record<string, string> = {
  healthy: "#46f0c2",
  degraded: "#ffc83c",
  failing: "#ff5050",
  unknown: "#4a6070",
};

const KIND_COLOR: Record<string, string> = {
  Ingress: "#818cf8",
  Service: "#a78bfa",
  Deployment: "#46f0c2",
  StatefulSet: "#34d399",
  DaemonSet: "#6ee7b7",
};

const EDGE_COLOR: Record<string, string> = {
  ingress: "#818cf8",
  "service-selector": "#a78bfa",
  "env-ref": "#f97316",
};

function layerOrder(kind: string): number {
  if (kind === "Ingress") return 0;
  if (kind === "Service") return 1;
  return 2;
}

function computeLayout(nodes: ServiceMapNode[]): Map<string, NodePosition> {
  const layers: ServiceMapNode[][] = [[], [], []];
  for (const node of nodes) layers[layerOrder(node.kind)].push(node);

  const positions = new Map<string, NodePosition>();
  layers.forEach((layer, li) => {
    const totalW = layer.length * NODE_W + (layer.length - 1) * NODE_GAP;
    layer.forEach((node, ni) => {
      positions.set(node.id, {
        x: CANVAS_PAD + ni * (NODE_W + NODE_GAP) + (totalW < 1 ? 0 : 0),
        y: CANVAS_PAD + li * (NODE_H + LAYER_GAP),
      });
    });
  });
  return positions;
}

function canvasSize(positions: Map<string, NodePosition>) {
  let maxX = 0;
  let maxY = 0;
  for (const { x, y } of positions.values()) {
    if (x + NODE_W > maxX) maxX = x + NODE_W;
    if (y + NODE_H > maxY) maxY = y + NODE_H;
  }
  return { width: maxX + CANVAS_PAD, height: maxY + CANVAS_PAD };
}

type NodeCardProps = {
  node: ServiceMapNode;
  pos: NodePosition;
  selected: boolean;
  atRisk: boolean;
  onHover: (id: string | null) => void;
  onClick: (node: ServiceMapNode) => void;
};

function NodeCard({ node, pos, selected, atRisk, onHover, onClick }: NodeCardProps) {
  const fill = HEALTH_FILL[node.health] ?? HEALTH_FILL.unknown;
  const stroke = selected
    ? "#ffffff"
    : atRisk
      ? "#f97316"
      : (HEALTH_STROKE[node.health] ?? HEALTH_STROKE.unknown);
  const kindColor = KIND_COLOR[node.kind] ?? "#9bb0c2";

  return (
    <g
      transform={`translate(${pos.x},${pos.y})`}
      style={{ cursor: "pointer" }}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onClick(node)}
    >
      {atRisk && (
        <rect
          x={-4}
          y={-4}
          width={NODE_W + 8}
          height={NODE_H + 8}
          rx={14}
          fill="rgba(249,115,22,0.15)"
          stroke="#f97316"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
      )}
      <rect
        width={NODE_W}
        height={NODE_H}
        rx={10}
        fill={fill}
        stroke={stroke}
        strokeWidth={selected ? 2 : 1.5}
      />
      {/* kind badge */}
      <rect x={10} y={10} width={6} height={6} rx={2} fill={kindColor} />
      <text x={22} y={19} fontSize={9} fill={kindColor} fontFamily="monospace" letterSpacing="0.05em">
        {node.kind.toUpperCase()}
      </text>
      {/* name */}
      <text
        x={10}
        y={37}
        fontSize={12}
        fontWeight={600}
        fill="#eef2f2"
        fontFamily="system-ui, sans-serif"
      >
        {node.name.length > 18 ? node.name.slice(0, 17) + "…" : node.name}
      </text>
      {/* health indicator for workloads */}
      {node.total_pods > 0 && (
        <text x={10} y={50} fontSize={9} fill={HEALTH_STROKE[node.health] ?? "#9bb0c2"} fontFamily="monospace">
          {node.ready_pods}/{node.total_pods} ready · {node.restart_count} restarts
        </text>
      )}
    </g>
  );
}

type EdgeLineProps = {
  edge: ServiceMapEdge;
  positions: Map<string, NodePosition>;
  dimmed: boolean;
};

function EdgeLine({ edge, positions, dimmed }: EdgeLineProps) {
  const src = positions.get(edge.source);
  const tgt = positions.get(edge.target);
  if (!src || !tgt) return null;

  const x1 = src.x + NODE_W / 2;
  const y1 = src.y + NODE_H;
  const x2 = tgt.x + NODE_W / 2;
  const y2 = tgt.y;
  const my = (y1 + y2) / 2;

  const color = EDGE_COLOR[edge.edge_type] ?? "#4a6070";
  const markerId = `arrow-${edge.edge_type}`;

  return (
    <path
      d={`M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`}
      fill="none"
      stroke={color}
      strokeWidth={dimmed ? 0.5 : 1.5}
      strokeOpacity={dimmed ? 0.2 : 0.7}
      markerEnd={`url(#${markerId})`}
    />
  );
}

type DetailPanelProps = {
  node: ServiceMapNode;
  edges: ServiceMapEdge[];
  onClose: () => void;
};

function DetailPanel({ node, edges, onClose }: DetailPanelProps) {
  const inbound = edges.filter((e) => e.target === node.id);
  const outbound = edges.filter((e) => e.source === node.id);

  return (
    <div className="glass-panel absolute right-4 top-4 z-10 w-72 rounded-2xl p-4 text-sm">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted">{node.kind}</p>
          <p className="mt-0.5 font-semibold text-foreground">{node.name}</p>
        </div>
        <button onClick={onClose} className="text-muted hover:text-foreground">✕</button>
      </div>

      {node.total_pods > 0 && (
        <div className="mb-3 rounded-xl border border-line bg-surface-strong px-3 py-2">
          <div className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: HEALTH_STROKE[node.health] ?? "#9bb0c2" }}
            />
            <span className="capitalize text-foreground">{node.health}</span>
          </div>
          <p className="mt-1 text-xs text-muted">
            {node.ready_pods}/{node.total_pods} pods ready · {node.restart_count} total restarts
          </p>
        </div>
      )}

      {inbound.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 text-xs text-muted">Receives traffic from</p>
          {inbound.map((e) => (
            <p key={e.source} className="text-xs text-foreground opacity-80">
              ← {e.source} <span className="text-muted">({e.edge_type})</span>
            </p>
          ))}
        </div>
      )}

      {outbound.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-muted">Sends traffic to</p>
          {outbound.map((e) => (
            <p key={e.target} className="text-xs text-foreground opacity-80">
              → {e.target} <span className="text-muted">({e.edge_type})</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

type Props = {
  map: ServiceMap;
};

export function ServiceMapView({ map }: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<ServiceMapNode | null>(null);

  const positions = useMemo(() => computeLayout(map.nodes), [map.nodes]);
  const { width, height } = useMemo(() => canvasSize(positions), [positions]);
  const cascadeIds = useMemo(
    () => computeCascadeRisk(hoveredId, map.edges),
    [hoveredId, map.edges]
  );

  const hasHover = hoveredId !== null;

  const legend = [
    { label: "Ingress", color: KIND_COLOR.Ingress },
    { label: "Service", color: KIND_COLOR.Service },
    { label: "Workload", color: KIND_COLOR.Deployment },
    { label: "env-ref edge", color: EDGE_COLOR["env-ref"] },
    { label: "Cascade risk", color: "#f97316" },
  ];

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {map.nodes.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-muted">
          No workloads or services found in this namespace.
        </div>
      ) : (
        <>
          {/* Legend */}
          <div className="mb-3 flex flex-wrap gap-4 px-1">
            {legend.map(({ label, color }) => (
              <div key={label} className="flex items-center gap-1.5 text-xs text-muted">
                <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                {label}
              </div>
            ))}
            <div className="ml-auto text-xs text-muted">Hover a node to see cascade risk</div>
          </div>

          {/* SVG Canvas */}
          <div className="relative min-h-0 flex-1 overflow-auto">
            <svg
              width={width}
              height={height}
              style={{ minWidth: width, minHeight: height }}
            >
              <defs>
                {Object.entries(EDGE_COLOR).map(([type, color]) => (
                  <marker
                    key={type}
                    id={`arrow-${type}`}
                    markerWidth="8"
                    markerHeight="6"
                    refX="7"
                    refY="3"
                    orient="auto"
                  >
                    <polygon points="0 0, 8 3, 0 6" fill={color} opacity="0.7" />
                  </marker>
                ))}
              </defs>

              {/* Edges (below nodes) */}
              {map.edges.map((edge, i) => (
                <EdgeLine
                  key={i}
                  edge={edge}
                  positions={positions}
                  dimmed={hasHover && !cascadeIds.has(edge.source) && edge.target !== hoveredId}
                />
              ))}

              {/* Nodes */}
              {map.nodes.map((node) => {
                const pos = positions.get(node.id);
                if (!pos) return null;
                return (
                  <NodeCard
                    key={node.id}
                    node={node}
                    pos={pos}
                    selected={selectedNode?.id === node.id}
                    atRisk={cascadeIds.has(node.id)}
                    onHover={setHoveredId}
                    onClick={(n) =>
                      setSelectedNode((prev) => (prev?.id === n.id ? null : n))
                    }
                  />
                );
              })}
            </svg>

            {selectedNode && (
              <DetailPanel
                node={selectedNode}
                edges={map.edges}
                onClose={() => setSelectedNode(null)}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
