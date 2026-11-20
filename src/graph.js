import { MarkerType } from 'reactflow';

export const COLORS = {
  accent: '#7c6bff',
  ok: '#35c891',
  fail: '#ff6b6b',
};

const COLUMN_GAP = 260;
const ROW_GAP = 132;
const GROUP_X = 300;
const ENDPOINT_X = 620;

function endpointSubtitle(result) {
  const bits = [result.method];
  if (result.count !== undefined && result.count !== null) bits.push(`${result.count} records`);
  bits.push(`HTTP ${result.status}`);
  return bits.join(' · ');
}

/**
 * Builds a three-column graph: server -> resource groups -> endpoints.
 * Endpoints stack vertically within each group column so the layout stays
 * readable no matter how many probes are discovered.
 */
export function buildGraph(results) {
  const nodes = [{
    id: 'server',
    type: 'input',
    position: { x: 0, y: 320 },
    data: { label: 'Deltapath Server', sub: 'API entry point', tone: 'server' },
    style: { width: 200 },
  }];

  const edges = [];
  const groups = [...new Set(results.map((r) => r.group))];
  const cursors = {};

  groups.forEach((group, gi) => {
    const members = results.filter((r) => r.group === group);
    const gid = `group-${group}`;
    const gy = 40 + gi * ROW_GAP;
    cursors[gid] = gy;

    nodes.push({
      id: gid,
      position: { x: GROUP_X, y: gy },
      data: { label: group, sub: `${members.length} discovered`, tone: 'group' },
      style: { width: 190 },
    });
    edges.push({
      id: `e-server-${gid}`,
      source: 'server',
      target: gid,
      animated: true,
      style: { stroke: COLORS.accent },
      markerEnd: { type: MarkerType.ArrowClosed, color: COLORS.accent },
    });

    members.forEach((result, ri) => {
      const nid = `endpoint-${result.id}`;
      const ny = gy + ri * ROW_GAP;
      nodes.push({
        id: nid,
        position: { x: ENDPOINT_X, y: ny },
        data: {
          label: result.label,
          sub: endpointSubtitle(result),
          tone: result.ok ? 'success' : 'error',
          status: result.status,
        },
        style: { width: 210 },
      });
      edges.push({
        id: `e-${gid}-${nid}`,
        source: gid,
        target: nid,
        style: { stroke: result.ok ? COLORS.ok : COLORS.fail },
        markerEnd: { type: MarkerType.ArrowClosed, color: result.ok ? COLORS.ok : COLORS.fail },
      });
      cursors[gid] = ny;
    });
  });

  return { nodes, edges };
}
