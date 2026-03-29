import { coerceBit, normalizeBitPattern } from './utils.js';

// A single FSM state: position for drawing, label for display, and outputs for Moore mode.
export class StateNode {
    constructor(id, label, x, y) {
        this.id = id;
        this.label = label;
        this.x = x;
        this.y = y;
        this.isInitial = false;
        this.outputs = {};
    }

    setInitial(value = true) {
        this.isInitial = value;
    }

    // Moore outputs are stored by signal name so the UI and synthesizer can
    // work with one or many output signals.
    setOutput(name, value) {
        this.outputs[name] = coerceBit(value);
    }

    // Replace the whole output map in one step.
    setOutputs(outputs) {
        this.outputs = {};
        for (const [name, value] of Object.entries(outputs)) {
            this.setOutput(name, value);
        }
    }

    toJSON() {
        return {
            id: this.id,
            label: this.label,
            x: this.x,
            y: this.y,
            isInitial: this.isInitial,
            outputs: { ...this.outputs },
        };
    }
}

// A directed edge between two states with an input pattern and optional outputs.
export class TransitionEdge {
    constructor(id, from, to, input) {
        this.id = id;
        this.from = from;
        this.to = to;
        this.input = input;
        this.outputs = {};
    }

    setOutput(name, value) {
        this.outputs[name] = coerceBit(value);
    }

    setOutputs(outputs) {
        this.outputs = {};
        for (const [name, value] of Object.entries(outputs)) {
            this.setOutput(name, value);
        }
    }

    // Build the label that appears on the canvas next to the arrow.
    getLabel(inputNames, outputNames, machineType = 'moore') {
        const inputParts = Array.from(this.input).map((bit, index) => {
            const inputName = inputNames[index] || `I${index}`;
            return `${inputName}=${bit}`;
        });

        if (machineType !== 'mealy') {
            return inputParts.join(', ');
        }

        const outputParts = outputNames
            .filter((name) => this.outputs[name] !== undefined)
            .map((name) => `${name}=${this.outputs[name]}`);

        return outputParts.length > 0
            ? `${inputParts.join(', ')} / ${outputParts.join(', ')}`
            : inputParts.join(', ');
    }

    toJSON() {
        return {
            id: this.id,
            from: this.from,
            to: this.to,
            input: this.input,
            outputs: { ...this.outputs },
        };
    }
}

// Top-level FSM container used by the editor, inspector, and synthesizer.
export class MachineGraph {
    constructor() {
        this.type = 'moore';
        this.inputNames = ['X'];
        this.outputNames = ['Z'];
        this.states = [];
        this.transitions = [];
        this._nextStateIndex = 0;
        this._nextTransitionIndex = 0;
    }

    // Drop all states and transitions but keep the same object instance.
    reset() {
        this.states = [];
        this.transitions = [];
        this._nextStateIndex = 0;
        this._nextTransitionIndex = 0;
    }

    // Create a new state at the requested position. The very first state becomes
    // the initial state automatically so the user can start testing quickly.
    addState(x, y) {
        const id = `S${this._nextStateIndex}`;
        const label = `S${this._nextStateIndex}`;
        const state = new StateNode(id, label, x, y);

        if (this.states.length === 0) {
            state.setInitial(true);
        }

        this._nextStateIndex += 1;
        this.states.push(state);
        return state;
    }

    // Remove a state and all edges connected to it.
    removeState(stateId) {
        const state = this.getState(stateId);
        if (!state) {
            return;
        }

        const wasInitial = state.isInitial;
        this.states = this.states.filter((item) => item.id !== stateId);
        this.transitions = this.transitions.filter(
            (edge) => edge.from !== stateId && edge.to !== stateId
        );

        if (wasInitial && this.states.length > 0 && !this.getInitialState()) {
            this.states[0].setInitial(true);
        }
    }

    // Look up helpers used across the UI and synthesis pipeline.
    getState(stateId) {
        return this.states.find((state) => state.id === stateId) || null;
    }

    setInitialState(stateId) {
        for (const state of this.states) {
            state.setInitial(state.id === stateId);
        }
    }

    getInitialState() {
        return this.states.find((state) => state.isInitial) || null;
    }

    // Add a transition only after confirming the input pattern has the right width.
    addTransition(fromId, toId, input, outputs = {}) {
        const normalizedInput = normalizeBitPattern(input, this.inputNames.length);
        if (!normalizedInput) {
            throw new Error(`Transition inputs must be ${this.inputNames.length} binary bit(s).`);
        }

        const transition = new TransitionEdge(
            `T${this._nextTransitionIndex}`,
            fromId,
            toId,
            normalizedInput
        );
        transition.setOutputs(outputs);

        this._nextTransitionIndex += 1;
        this.transitions.push(transition);
        return transition;
    }

    removeTransition(transitionId) {
        this.transitions = this.transitions.filter((transition) => transition.id !== transitionId);
    }

    getTransition(transitionId) {
        return this.transitions.find((transition) => transition.id === transitionId) || null;
    }

    transitionsFrom(stateId) {
        return this.transitions.filter((transition) => transition.from === stateId);
    }

    // Validation is intentionally strict about correctness and only uses warnings
    // for cases that are still synthesizable.
    validate() {
        const errors = [];
        const warnings = [];

        // Structural minimums.
        if (this.states.length < 2) {
            errors.push('FSM must have at least 2 states.');
        }

        if (!this.getInitialState()) {
            errors.push('No initial state is set.');
        }

        if (this.transitions.length === 0) {
            errors.push('FSM has no transitions defined.');
        }

        // State labels should stay unique so the UI and report remain easy to read.
        const stateNames = new Set();
        for (const state of this.states) {
            if (stateNames.has(state.label)) {
                errors.push(`Duplicate state name "${state.label}".`);
            }
            stateNames.add(state.label);
        }

        // Every transition must reference valid states and a valid binary input.
        const stateIds = new Set(this.states.map((state) => state.id));
        for (const transition of this.transitions) {
            if (!stateIds.has(transition.from) || !stateIds.has(transition.to)) {
                errors.push(`Transition "${transition.id}" references a missing state.`);
            }

            const normalizedInput = normalizeBitPattern(transition.input, this.inputNames.length);
            if (!normalizedInput) {
                errors.push(
                    `Transition "${transition.id}" must use ${this.inputNames.length} binary bit(s).`
                );
            }
        }

        // Determinism check: one outgoing transition per input pattern.
        for (const state of this.states) {
            const outgoing = this.transitionsFrom(state.id);
            const inputsSeen = new Set();

            for (const transition of outgoing) {
                if (inputsSeen.has(transition.input)) {
                    errors.push(
                        `Non-deterministic transitions from "${state.label}" for input "${transition.input}".`
                    );
                }
                inputsSeen.add(transition.input);
            }

            if (outgoing.length === 0) {
                warnings.push(`State "${state.label}" has no outgoing transitions.`);
            }
        }

        // Reachability check starting from the initial state.
        const initialState = this.getInitialState();
        if (initialState) {
            const reachable = new Set([initialState.id]);
            const queue = [initialState.id];

            while (queue.length > 0) {
                const current = queue.shift();
                for (const transition of this.transitionsFrom(current)) {
                    if (!reachable.has(transition.to)) {
                        reachable.add(transition.to);
                        queue.push(transition.to);
                    }
                }
            }

            for (const state of this.states) {
                if (!reachable.has(state.id)) {
                    warnings.push(`State "${state.label}" is unreachable from the initial state.`);
                }
            }
        }

        // Output completeness depends on whether the FSM is Moore or Mealy.
        if (this.type === 'moore') {
            for (const state of this.states) {
                for (const outputName of this.outputNames) {
                    if (state.outputs[outputName] === undefined) {
                        warnings.push(
                            `Moore output "${outputName}" is not set for state "${state.label}".`
                        );
                    }
                }
            }
        } else {
            for (const transition of this.transitions) {
                for (const outputName of this.outputNames) {
                    if (transition.outputs[outputName] === undefined) {
                        warnings.push(
                            `Mealy output "${outputName}" is not set for transition "${transition.id}".`
                        );
                    }
                }
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
        };
    }

    // Snapshot shape used by the report view.
    toJSON() {
        return {
            type: this.type,
            inputs: [...this.inputNames],
            outputs: [...this.outputNames],
            states: this.states.map((state) => state.toJSON()),
            transitions: this.transitions.map((transition) => transition.toJSON()),
        };
    }
}
