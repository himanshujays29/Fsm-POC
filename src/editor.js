import { clamp, normalizeBitPattern } from './utils.js';

// CanvasEditor handles all visual drawing plus direct mouse interaction.
export class CanvasEditor {
    constructor({ canvas, machine, onSelectionChange, onMachineChange, onStatusChange }) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.machine = machine;
        this.onSelectionChange = onSelectionChange || (() => {});
        this.onMachineChange = onMachineChange || (() => {});
        this.onStatusChange = onStatusChange || (() => {});

        this.stateRadius = 34;
        this.selectedStateId = null;
        this.selectedTransitionId = null;
        this.dragStateId = null;
        this.linkStartStateId = null;
        this.pointer = { x: 0, y: 0 };
        this.dragOffset = { x: 0, y: 0 };
        this.dragMoved = false;
        this.transitionGeometry = [];

        this._bindEvents();
        this.render();
    }

    // Resize is forwarded from the layout code whenever the board card changes size.
    setSize(width, height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.render();
    }

    // Clear whichever state or transition is currently active in the inspector.
    clearSelection() {
        this.selectedStateId = null;
        this.selectedTransitionId = null;
        this.onSelectionChange(this.getSelection());
        this.render();
    }

    // Return the selected machine object in a shape the UI can consume directly.
    getSelection() {
        if (this.selectedStateId) {
            return {
                type: 'state',
                item: this.machine.getState(this.selectedStateId),
            };
        }

        if (this.selectedTransitionId) {
            return {
                type: 'transition',
                item: this.machine.getTransition(this.selectedTransitionId),
            };
        }

        return null;
    }

    // Core pointer listeners for adding, dragging, selecting, and drawing transitions.
    _bindEvents() {
        this.canvas.addEventListener('dblclick', (event) => this._handleDoubleClick(event));
        this.canvas.addEventListener('mousedown', (event) => this._handleMouseDown(event));
        this.canvas.addEventListener('mousemove', (event) => this._handleMouseMove(event));
        this.canvas.addEventListener('mouseup', (event) => this._handleMouseUp(event));
        this.canvas.addEventListener('mouseleave', (event) => this._handleMouseUp(event));
        this.canvas.addEventListener('contextmenu', (event) => this._handleContextMenu(event));
    }

    // Double-click on empty space creates a new state where the pointer lands.
    _handleDoubleClick(event) {
        const point = this._getPoint(event);

        if (this._hitTestState(point)) {
            return;
        }

        const state = this.machine.addState(
            clamp(point.x, this.stateRadius + 8, this.canvas.width - this.stateRadius - 8),
            clamp(point.y, this.stateRadius + 8, this.canvas.height - this.stateRadius - 8)
        );

        this.selectedStateId = state.id;
        this.selectedTransitionId = null;
        this.onMachineChange('structure');
        this.onSelectionChange(this.getSelection());
        this.onStatusChange(`Added ${state.label}.`);
        this.render();
    }

    // Mouse down either starts dragging, starts transition creation, or changes selection.
    _handleMouseDown(event) {
        if (event.button !== 0) {
            return;
        }

        const point = this._getPoint(event);
        const hitState = this._hitTestState(point);
        const hitTransition = this._hitTestTransition(point);
        this.pointer = point;

        if (hitState) {
            if (event.shiftKey) {
                this.linkStartStateId = hitState.id;
                this.selectedStateId = null;
                this.selectedTransitionId = null;
                this.onStatusChange(`Creating a transition from ${hitState.label}.`);
            } else {
                this.dragStateId = hitState.id;
                this.dragMoved = false;
                this.dragOffset = {
                    x: point.x - hitState.x,
                    y: point.y - hitState.y,
                };
                this.selectedStateId = hitState.id;
                this.selectedTransitionId = null;
                this.onStatusChange(`Selected ${hitState.label}.`);
            }
        } else if (hitTransition) {
            this.selectedTransitionId = hitTransition.id;
            this.selectedStateId = null;
            this.onStatusChange('Selected transition.');
        } else {
            this.selectedStateId = null;
            this.selectedTransitionId = null;
        }

        this.onSelectionChange(this.getSelection());
        this.render();
    }

    // Mouse move updates the drag position or the temporary preview line.
    _handleMouseMove(event) {
        const point = this._getPoint(event);
        this.pointer = point;

        if (this.dragStateId) {
            const state = this.machine.getState(this.dragStateId);
            if (!state) {
                return;
            }

            state.x = clamp(
                point.x - this.dragOffset.x,
                this.stateRadius + 8,
                this.canvas.width - this.stateRadius - 8
            );
            state.y = clamp(
                point.y - this.dragOffset.y,
                this.stateRadius + 8,
                this.canvas.height - this.stateRadius - 8
            );
            this.dragMoved = true;
            this.render();
            return;
        }

        if (this.linkStartStateId) {
            this.render();
        }
    }

    // Mouse up finalizes either a new transition or a drag operation.
    _handleMouseUp(event) {
        const point = this._getPoint(event);

        if (this.linkStartStateId) {
            const source = this.machine.getState(this.linkStartStateId);
            const target = this._hitTestState(point);
            const defaultInput = '0'.repeat(this.machine.inputNames.length);

            if (source && target) {
                const rawInput = window.prompt(
                    `Input pattern for ${source.label} -> ${target.label}`,
                    defaultInput
                );

                if (rawInput !== null) {
                    const normalized = normalizeBitPattern(
                        rawInput,
                        this.machine.inputNames.length
                    );

                    if (normalized) {
                        const transition = this.machine.addTransition(source.id, target.id, normalized);
                        this.selectedTransitionId = transition.id;
                        this.selectedStateId = null;
                        this.onMachineChange('structure');
                        this.onSelectionChange(this.getSelection());
                        this.onStatusChange(
                            `Added transition ${source.label} -> ${target.label} with input ${normalized}.`
                        );
                    } else {
                        this.onStatusChange(
                            `Transitions need ${this.machine.inputNames.length} binary bit(s).`
                        );
                    }
                }
            }

            this.linkStartStateId = null;
            this.render();
            return;
        }

        if (this.dragStateId) {
            if (this.dragMoved) {
                this.onMachineChange('layout');
                this.onStatusChange('Moved state.');
            }

            this.dragStateId = null;
            this.dragMoved = false;
            this.render();
        }
    }

    // Right click is treated as a quick selection gesture instead of using the browser menu.
    _handleContextMenu(event) {
        event.preventDefault();
        const point = this._getPoint(event);
        const hitState = this._hitTestState(point);
        const hitTransition = this._hitTestTransition(point);

        if (hitState) {
            this.selectedStateId = hitState.id;
            this.selectedTransitionId = null;
        } else if (hitTransition) {
            this.selectedTransitionId = hitTransition.id;
            this.selectedStateId = null;
        } else {
            this.selectedStateId = null;
            this.selectedTransitionId = null;
        }

        this.onSelectionChange(this.getSelection());
        this.render();
    }

    // Convert viewport mouse coordinates into canvas-local coordinates.
    _getPoint(event) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
        };
    }

    // States are simple circle hits.
    _hitTestState(point) {
        for (const state of this.machine.states) {
            const dx = point.x - state.x;
            const dy = point.y - state.y;
            if (dx * dx + dy * dy <= this.stateRadius * this.stateRadius) {
                return state;
            }
        }
        return null;
    }

    // Transition hit testing uses the geometry captured during the last render pass.
    _hitTestTransition(point) {
        for (const geometry of this.transitionGeometry) {
            if (geometry.kind === 'line') {
                if (this._distanceToSegment(point, geometry.start, geometry.end) <= 10) {
                    return geometry;
                }
                continue;
            }

            if (geometry.kind === 'curve') {
                if (
                    this._distanceToQuadratic(point, geometry.start, geometry.control, geometry.end) <=
                    10
                ) {
                    return geometry;
                }
                continue;
            }

            const distanceToCenter = Math.hypot(point.x - geometry.center.x, point.y - geometry.center.y);
            if (Math.abs(distanceToCenter - geometry.radius) <= 10 && point.y <= geometry.center.y + 22) {
                return geometry;
            }
        }

        return null;
    }

    // Distance helpers are used by the transition hit tests.
    _distanceToSegment(point, a, b) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lengthSquared = dx * dx + dy * dy;

        if (lengthSquared === 0) {
            return Math.hypot(point.x - a.x, point.y - a.y);
        }

        let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
        t = Math.max(0, Math.min(1, t));

        const projection = {
            x: a.x + dx * t,
            y: a.y + dy * t,
        };

        return Math.hypot(point.x - projection.x, point.y - projection.y);
    }

    _distanceToQuadratic(point, start, control, end) {
        let best = Number.POSITIVE_INFINITY;
        let previous = start;

        for (let step = 1; step <= 22; step += 1) {
            const t = step / 22;
            const sample = this._quadraticPoint(start, control, end, t);
            best = Math.min(best, this._distanceToSegment(point, previous, sample));
            previous = sample;
        }

        return best;
    }

    // Sample a point on a quadratic Bezier curve.
    _quadraticPoint(start, control, end, t) {
        const inverse = 1 - t;
        return {
            x: inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
            y: inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y,
        };
    }

    // Master render order: background, edges, draft edge, then states on top.
    render() {
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#fbf7f0';
        ctx.fillRect(0, 0, width, height);

        this._drawGrid(ctx, width, height);
        this._drawTransitions(ctx);
        this._drawDraftLine(ctx);
        this._drawStates(ctx);
    }

    // Decorative dotted grid to help the canvas feel like a workspace.
    _drawGrid(ctx, width, height) {
        ctx.fillStyle = 'rgba(197, 106, 77, 0.11)';

        for (let y = 18; y < height; y += 28) {
            for (let x = 18; x < width; x += 28) {
                ctx.fillRect(x, y, 2, 2);
            }
        }
    }

    // Draw every transition and remember the geometry for hit testing.
    _drawTransitions(ctx) {
        this.transitionGeometry = [];

        for (const edge of this.machine.transitions) {
            const from = this.machine.getState(edge.from);
            const to = this.machine.getState(edge.to);

            if (!from || !to) {
                continue;
            }

            const isSelected = edge.id === this.selectedTransitionId;

            if (edge.from === edge.to) {
                const geometry = this._buildLoopGeometry(from, edge.id);
                this.transitionGeometry.push(geometry);
                this._drawLoop(ctx, geometry, edge, isSelected);
                continue;
            }

            const hasReverse = this.machine.transitions.some(
                (other) => other.id !== edge.id && other.from === edge.to && other.to === edge.from
            );

            if (hasReverse) {
                const geometry = this._buildCurvedGeometry(from, to, edge.id);
                this.transitionGeometry.push(geometry);
                this._drawCurve(ctx, geometry, edge, isSelected);
                continue;
            }

            const geometry = this._buildLineGeometry(from, to, edge.id);
            this.transitionGeometry.push(geometry);
            this._drawLine(ctx, geometry, edge, isSelected);
        }
    }

    // Straight edges are used when there is no reverse edge between the same states.
    _buildLineGeometry(from, to, edgeId) {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const distance = Math.hypot(dx, dy) || 1;
        const unitX = dx / distance;
        const unitY = dy / distance;

        const start = {
            x: from.x + unitX * this.stateRadius,
            y: from.y + unitY * this.stateRadius,
        };
        const end = {
            x: to.x - unitX * this.stateRadius,
            y: to.y - unitY * this.stateRadius,
        };

        return {
            id: edgeId,
            kind: 'line',
            start,
            end,
            label: {
                x: (start.x + end.x) / 2 - unitY * 16,
                y: (start.y + end.y) / 2 + unitX * 16,
            },
        };
    }

    // Reverse edges are drawn as mirrored curves so both directions stay visible.
    _buildCurvedGeometry(from, to, edgeId) {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const distance = Math.hypot(dx, dy) || 1;
        const unitX = dx / distance;
        const unitY = dy / distance;
        const start = {
            x: from.x + unitX * this.stateRadius,
            y: from.y + unitY * this.stateRadius,
        };
        const end = {
            x: to.x - unitX * this.stateRadius,
            y: to.y - unitY * this.stateRadius,
        };

        const midpoint = {
            x: (start.x + end.x) / 2,
            y: (start.y + end.y) / 2,
        };

        const sign = from.id < to.id ? 1 : -1;
        const offset = 40 * sign;
        const control = {
            x: midpoint.x - unitY * offset,
            y: midpoint.y + unitX * offset,
        };

        return {
            id: edgeId,
            kind: 'curve',
            start,
            control,
            end,
            label: this._quadraticPoint(start, control, end, 0.5),
        };
    }

    // Self-loops are drawn as a small arc above the state.
    _buildLoopGeometry(state, edgeId) {
        return {
            id: edgeId,
            kind: 'loop',
            center: {
                x: state.x,
                y: state.y - this.stateRadius - 18,
            },
            radius: 20,
            startAngle: 0.3 * Math.PI,
            endAngle: 2.7 * Math.PI,
            label: {
                x: state.x,
                y: state.y - this.stateRadius - 54,
            },
        };
    }

    // Concrete drawing routines for each transition shape.
    _drawLine(ctx, geometry, edge, isSelected) {
        ctx.strokeStyle = isSelected ? '#c56a4d' : '#334750';
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.beginPath();
        ctx.moveTo(geometry.start.x, geometry.start.y);
        ctx.lineTo(geometry.end.x, geometry.end.y);
        ctx.stroke();

        this._drawArrow(ctx, geometry.start, geometry.end);
        this._drawTransitionLabel(ctx, edge, geometry.label, isSelected);
    }

    _drawCurve(ctx, geometry, edge, isSelected) {
        ctx.strokeStyle = isSelected ? '#c56a4d' : '#334750';
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.beginPath();
        ctx.moveTo(geometry.start.x, geometry.start.y);
        ctx.quadraticCurveTo(
            geometry.control.x,
            geometry.control.y,
            geometry.end.x,
            geometry.end.y
        );
        ctx.stroke();

        this._drawArrow(ctx, geometry.control, geometry.end);
        this._drawTransitionLabel(ctx, edge, geometry.label, isSelected);
    }

    _drawLoop(ctx, geometry, edge, isSelected) {
        ctx.strokeStyle = isSelected ? '#c56a4d' : '#334750';
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.beginPath();
        ctx.arc(
            geometry.center.x,
            geometry.center.y,
            geometry.radius,
            geometry.startAngle,
            geometry.endAngle
        );
        ctx.stroke();

        const endPoint = {
            x: geometry.center.x + geometry.radius * Math.cos(geometry.endAngle),
            y: geometry.center.y + geometry.radius * Math.sin(geometry.endAngle),
        };
        const tangent = {
            x: -Math.sin(geometry.endAngle),
            y: Math.cos(geometry.endAngle),
        };
        const arrowFrom = {
            x: endPoint.x - tangent.x * 12,
            y: endPoint.y - tangent.y * 12,
        };

        this._drawArrow(ctx, arrowFrom, endPoint);
        this._drawTransitionLabel(ctx, edge, geometry.label, isSelected);
    }

    // Shared arrowhead helper used by straight, curved, and loop edges.
    _drawArrow(ctx, from, to) {
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        const size = 10;

        ctx.beginPath();
        ctx.moveTo(to.x, to.y);
        ctx.lineTo(
            to.x - size * Math.cos(angle - Math.PI / 6),
            to.y - size * Math.sin(angle - Math.PI / 6)
        );
        ctx.moveTo(to.x, to.y);
        ctx.lineTo(
            to.x - size * Math.cos(angle + Math.PI / 6),
            to.y - size * Math.sin(angle + Math.PI / 6)
        );
        ctx.stroke();
    }

    // Transition labels sit on a rounded rectangle so they remain readable over the grid.
    _drawTransitionLabel(ctx, edge, position, isSelected) {
        const label = edge.getLabel(
            this.machine.inputNames,
            this.machine.outputNames,
            this.machine.type
        );

        ctx.font = '12px Trebuchet MS';
        const metrics = ctx.measureText(label);
        const width = metrics.width + 18;
        const height = 22;
        const x = position.x - width / 2;
        const y = position.y - height / 2;

        ctx.fillStyle = isSelected ? 'rgba(243, 221, 213, 0.98)' : 'rgba(255, 253, 249, 0.96)';
        this._roundedRect(ctx, x, y, width, height, 11);
        ctx.fill();

        ctx.strokeStyle = isSelected ? '#c56a4d' : 'rgba(32, 49, 59, 0.18)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = '#20313b';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, position.x, position.y + 0.5);
    }

    // While creating a new edge, show a temporary dashed guide line.
    _drawDraftLine(ctx) {
        if (!this.linkStartStateId) {
            return;
        }

        const source = this.machine.getState(this.linkStartStateId);
        if (!source) {
            return;
        }

        ctx.save();
        ctx.setLineDash([9, 7]);
        ctx.strokeStyle = 'rgba(197, 106, 77, 0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(this.pointer.x, this.pointer.y);
        ctx.stroke();
        ctx.restore();
    }

    // States are drawn last so they sit above all transition lines.
    _drawStates(ctx) {
        for (const state of this.machine.states) {
            const isSelected = state.id === this.selectedStateId;

            ctx.beginPath();
            ctx.arc(state.x, state.y, this.stateRadius, 0, Math.PI * 2);
            ctx.fillStyle = '#fffdf9';
            ctx.fill();
            ctx.lineWidth = isSelected ? 4 : 2;
            ctx.strokeStyle = isSelected ? '#c56a4d' : '#20313b';
            ctx.stroke();

            if (state.isInitial) {
                ctx.beginPath();
                ctx.arc(
                    state.x - this.stateRadius + 10,
                    state.y - this.stateRadius + 10,
                    6,
                    0,
                    Math.PI * 2
                );
                ctx.fillStyle = '#2f694d';
                ctx.fill();
            }

            ctx.fillStyle = '#20313b';
            ctx.font = 'bold 14px Trebuchet MS';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(state.label, state.x, state.y);

            const outputText = this.machine.outputNames
                .map((name) => `${name}:${state.outputs[name] ?? '?'}`)
                .join('  ');

            if (outputText) {
                ctx.font = '12px Trebuchet MS';
                const metrics = ctx.measureText(outputText);
                const width = metrics.width + 16;
                const height = 22;
                const x = state.x - width / 2;
                const y = state.y + this.stateRadius + 12;

                ctx.fillStyle = isSelected ? 'rgba(243, 221, 213, 0.95)' : 'rgba(255, 248, 238, 0.98)';
                this._roundedRect(ctx, x, y, width, height, 11);
                ctx.fill();
                ctx.strokeStyle = 'rgba(32, 49, 59, 0.14)';
                ctx.lineWidth = 1;
                ctx.stroke();

                ctx.fillStyle = '#20313b';
                ctx.fillText(outputText, state.x, y + height / 2);
            }
        }
    }

    // Small utility for the rounded pills used by state outputs and labels.
    _roundedRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    }
}
