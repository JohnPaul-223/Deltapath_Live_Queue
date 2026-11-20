import React, { useMemo } from 'react';
import ReactFlow, { Background, Controls, MiniMap } from 'reactflow';

function nodeColor(node) {
  if (node.data?.tone === 'success') return '#35c891';
  if (node.data?.tone === 'error') return '#ff6b6b';
  return '#7c6bff';
}

function FlowCanvas({ graph }) {
  const defaultEdgeOptions = useMemo(() => ({ type: 'smoothstep', animated: false }), []);
  return (
    <ReactFlow
      nodes={graph.nodes}
      edges={graph.edges}
      defaultEdgeOptions={defaultEdgeOptions}
      fitView
      fitViewOptions={{ padding: 0.22, duration: 600 }}
      minZoom={0.2}
      maxZoom={1.6}
    >
      <Background gap={20} size={1} color="#232734" />
      <Controls />
      <MiniMap pannable zoomable nodeColor={nodeColor} maskColor="#090b10cc" />
    </ReactFlow>
  );
}

export default FlowCanvas;
