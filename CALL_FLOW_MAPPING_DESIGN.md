# Deltapath Call-Flow Mapping Design

## Administrator Guide Findings

The Administrator Guide for Deltapath UC 5.3 describes the configuration model that produces call behavior.

### Main call-flow layers

1. **External entry**
   - PSTN caller
   - SIP trunk or provider
   - gateway or legacy PBX
   - DID/inbound peer

2. **Inbound routing**
   - inbound peer
   - DID/inbound range
   - internal extension range
   - actual DID range
   - caller-ID prefix

3. **Numbering and permissions**
   - context
   - permission group
   - inbound/outbound number pattern
   - caller-ID manipulation
   - digit strip/prepend rules

4. **Destination processing**
   - extension or user
   - hunt group
   - queue
   - IVR menu
   - directory or user-management center
   - conference
   - voicemail
   - external or DTMF dial action

5. **Personal routing**
   - number status
   - time slot
   - simple or advanced schedule
   - call forwarding
   - DND/voicemail
   - simultaneous or sequential destinations

6. **Outbound routing**
   - dialed number pattern
   - context
   - SIP peer or peer group
   - strip/prepend transformation
   - caller-ID handling

### Deltapath-specific behavior to represent

- **Inbound Routing:** map PSTN/Gateway/SIP-Trunk DID ranges to internal extension ranges.
- **Outbound Routing:** show the matched dial pattern, context, peer, digit transformation, and caller-ID result.
- **IVR:** represent menus as nodes and keypad options as labeled edges. Include invalid input, no-input, timeout, retry, conditional routing, action-before-exit, and disconnect behavior.
- **Hunt Group:** show Top-Down and Circular distribution, ring timeout, group member order, and next-number-status behavior.
- **Queue:** show queue membership, routing attempt, timeout, busy state, and fallback.
- **Schedules:** show number-status/time-slot relationships and the active routing steps.
- **Call forwarding and DND:** show forwarding destination or voicemail fallback.
- **High availability:** show primary/secondary UC servers and gateway failover for inbound/outbound traffic.

## Recommended Map Models

### 1. System Topology View

Purpose: explain where Deltapath components exist.

Node types:
- PSTN/telephone company
- SIP trunk/provider
- gateway/PBX
- Deltapath primary server
- Deltapath secondary server
- IVR
- queue
- hunt group
- conference
- extension/user
- voicemail

Edges:
- SIP signaling
- PSTN signaling
- RTP/media
- route rule
- failover link
- schedule trigger

This view answers: “What is connected to what?”

### 2. Inbound Call Route Trace

Purpose: explain one incoming call end-to-end.

Example path:

`PSTN/SIP Peer -> Inbound Peer -> DID Range -> Context/Permission -> Destination -> Schedule/Number Status -> Extension/Queue/IVR/Voicemail`

A route detail panel should show:
- caller CID
- called DID
- matched inbound range
- matched internal extension
- resolved number status
- active time slot
- selected routing step
- fallback result

### 3. Outbound Route Trace

Purpose: explain why a dialed number reaches a particular peer.

Example path:

`Extension Dials Pattern -> Context/Permission -> Outbound Rule -> Strip Digits -> Prepend Digits -> SIP Peer/Peer Group -> Caller-ID Result`

### 4. IVR Decision Tree

Purpose: explain every keypad and fallback branch.

Node types:
- welcome menu
- keypad option
- conditional routing gate
- database variable action
- route to user/queue/extension
- voicemail
- retry/error
- disconnect

Edge labels:
- digit pressed
- timeout
- invalid input
- no input
- retries exceeded
- date/time condition
- default fallback

### 5. Schedule and Number-Status View

Purpose: explain time-dependent call behavior.

Show:
- schedule
- time slot
- day/time/date range
- number status
- ordered routing steps
- current state
- override
- forwarding/DND destination

### 6. Agent and Queue Distribution View

Purpose: explain inbound contact-center call delivery.

Show:
- incoming DID/IVR/queue
- queue timeout
- agents
- agent status
- queue strategy
- fallback

## UI Recommendations

Use an application with three panes:

- **Left:** search and resource tree for users, numbers, IVRs, queues, hunt groups, trunks, and gateways.
- **Center:** interactive directed graph with node grouping, mini-map, zoom, pan, fit, and collapse.
- **Right:** selected-object details, configuration summary, matched route, warnings, and source audit reference.

Important controls:
- Route testing using DID or extension
- Inbound/outbound mode switch
- IVR keypad simulation
- Schedule date/time selector
- Filter by customer/ACL context
- Show/hide infrastructure nodes
- Highlight the full trace path
- Compare before/after snapshots
- Export as PNG, SVG, JSON, and Mermaid

Use warning states for:
- no inbound DID match
- no outbound route match
- permission denied
- no number status assigned
- empty IVR fallback
- busy queue with no timeout fallback
- missing member or gateway
- HA/failover uncertainty

## Read-only Data Collection Policy

The mapper should remain read-only:
- only GET/list/view endpoints for discovery
- reject all POST/PUT/DELETE probes except temporary authentication token request and token expiry
- cache one snapshot per scan
- never persist credentials
- clearly mark inferred relationships separately from confirmed server configuration

## GitHub Reference Repositories

### Primary Graph and UI Choice

- **xyflow/xyflow** — https://github.com/xyflow/xyflow
  - React, Svelte, and Vue node graph libraries
  - custom nodes, edge labels, controls, mini-map, nested groups, and layout examples
  - strongest fit for the existing React application

- **dagrejs/dagre** — https://github.com/dagrejs/dagre
  - directed hierarchical layout
  - nested cluster support and LR/TB/BT/RL directions
  - useful for IVR trees, inbound traces, and outbound routes

- **antvis/G6** — https://github.com/antvis/G6
  - topology and tree layouts
  - minimap, decision/fund-flow examples, collapse/expand behavior, custom nodes
  - good for very large call/configuration maps

### Process and Flow Semantics

- **bpmn-io/bpmn-js** — https://github.com/bpmn-io/bpmn-js
  - gateways, sequence flows, call activities, subprocesses, and conditional/default paths
  - useful reference for route-node semantics and diagram editing patterns

- **mermaid-js/mermaid** — https://github.com/mermaid-js/mermaid
  - flowchart, sequence, architecture, user-journey, and agent-flow examples
  - useful for fast SVG/Mermaid export and text-based documentation

- **visjs/vis-network** — https://github.com/visjs/vis-network
  - hierarchical network layouts
  - directed/undirected navigation and clustering examples
  - useful fallback for topology-oriented views

## Recommendation

Keep React Flow/Xyflow as the existing canvas, add Dagre for automatic layouts, and model Deltapath as a graph rather than using a general free-form BPMN editor.

A recommended first implementation milestone is:

1. Build separate topology and route-trace views.
2. Add IVR keypad-tree discovery.
3. Resolve number-status/time-slot relationships.
4. Add a DID/extension/number route tester.
5. Add HA failover and queue/hunt/schedule overlays.
6. Export snapshots and provide before/after comparison.
