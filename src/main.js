import { MachineGraph } from './fsm.js';
import { CanvasEditor } from './editor.js';
import { runSynthesis } from './synthesizer.js';
import { coerceBit, escapeHtml, formatNumberList, joinNames, normalizeBitPattern } from './utils.js';

// The app works against a single in-memory FSM model.
const machine = new MachineGraph();

// Cache every DOM node we need once so the rest of the file can focus on behavior.
const refs = {
    canvas: document.getElementById('fsm-canvas'),
    canvasWrap: document.getElementById('canvas-wrap'),
    loadExampleBtn: document.getElementById('load-example-btn'),
    loadTrafficBtn: document.getElementById('load-traffic-btn'),
    synthesizeBtn: document.getElementById('synthesize-btn'),
    clearBtn: document.getElementById('clear-btn'),
    machineStats: document.getElementById('machine-stats'),
    statusCopy: document.getElementById('status-copy'),
    inspectorPanel: document.getElementById('inspector-panel'),
    resultsPanel: document.getElementById('results-panel'),
};

// The editor owns all pointer/canvas interaction and calls back into this file
// when selection or machine structure changes.
const editor = new CanvasEditor({
    canvas: refs.canvas,
    machine,
    onSelectionChange: renderInspector,
    onMachineChange: handleMachineChange,
    onStatusChange: setStatus,
});

// Boot sequence: connect listeners, size the canvas, and render the empty state.
bindEvents();
resizeCanvas();
renderMachineStats();
renderInspector();
renderResultsPlaceholder();

function bindEvents() {
    window.addEventListener('resize', resizeCanvas);

    refs.loadExampleBtn.addEventListener('click', () => {
        loadSequenceExample();
        renderResultsPlaceholder('Sequence detector loaded. Press Synthesize to generate the report.');
        setStatus('Loaded the sample sequence detector.');
    });

    refs.loadTrafficBtn.addEventListener('click', () => {
        loadTrafficLightExample();
        renderResultsPlaceholder('Traffic light controller loaded. Press Synthesize to generate the report.');
        setStatus('Loaded the traffic light example.');
    });

    refs.synthesizeBtn.addEventListener('click', synthesizeCurrentMachine);

    refs.clearBtn.addEventListener('click', () => {
        resetMachineConfiguration();
        editor.clearSelection();
        renderMachineStats();
        renderInspector();
        renderResultsPlaceholder('Canvas cleared. Add states or load one of the examples.');
        setStatus('Cleared the machine.');
    });

    // The inspector is re-rendered often, so delegated listeners are simpler than
    // attaching listeners to each generated button and input every time.
    refs.inspectorPanel.addEventListener('click', handleInspectorClick);
    refs.inspectorPanel.addEventListener('change', handleInspectorChange);

    // Escape is a quick way to leave the current selection without touching the mouse.
    document.addEventListener('keydown', (event) => {
        const tagName = event.target.tagName;
        if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
            return;
        }

        if (event.key === 'Escape') {
            editor.clearSelection();
            setStatus('Selection cleared.');
        }
    });
}

// Keep the drawing canvas matched to the available card size.
function resizeCanvas() {
    const width = Math.max(320, refs.canvasWrap.clientWidth - 36);
    const height = Math.max(420, refs.canvasWrap.clientHeight - 36);
    editor.setSize(width, height);
}

// Whenever the editor changes the underlying machine, keep the summary UI in sync.
function handleMachineChange(reason) {
    renderMachineStats();

    if (reason === 'structure') {
        markResultsStale();
    }
}

// The stats row is a compact snapshot of the current FSM dimensions.
function renderMachineStats() {
    refs.machineStats.innerHTML = `
        <div class="metric-card">
            <span>States</span>
            <strong>${machine.states.length}</strong>
        </div>
        <div class="metric-card">
            <span>Transitions</span>
            <strong>${machine.transitions.length}</strong>
        </div>
        <div class="metric-card">
            <span>Inputs</span>
            <strong>${escapeHtml(joinNames(machine.inputNames))}</strong>
        </div>
        <div class="metric-card">
            <span>Outputs</span>
            <strong>${escapeHtml(joinNames(machine.outputNames))}</strong>
        </div>
    `;
}

// Small helper used by the editor and the top-level actions to surface feedback.
function setStatus(message) {
    refs.statusCopy.textContent = message;
}

// The inspector swaps between a placeholder, a state editor, and a transition editor.
function renderInspector() {
    const selection = editor.getSelection();

    if (!selection || !selection.item) {
        refs.inspectorPanel.innerHTML = `
            <div class="placeholder-card">
                <h3>No active selection</h3>
                <p>Pick a state or transition to edit its properties here.</p>
                <ul class="helper-list">
                    <li>Double-click anywhere on the board to create a new state.</li>
                    <li>Shift and drag from one state to another to add a transition.</li>
                    <li>Use one of the example buttons if you want a working machine right away.</li>
                </ul>
            </div>
        `;
        return;
    }

    if (selection.type === 'state') {
        renderStateInspector(selection.item);
        return;
    }

    renderTransitionInspector(selection.item);
}

// State editing UI: label, outputs, and a few convenience actions.
function renderStateInspector(state) {
    const outputsMarkup = machine.outputNames
        .map((name) => {
            const value = state.outputs[name] ?? '';
            return `
                <label class="field">
                    <span>${escapeHtml(name)} output</span>
                    <input
                        type="text"
                        maxlength="1"
                        inputmode="numeric"
                        data-action="set-state-output"
                        data-name="${escapeHtml(name)}"
                        value="${escapeHtml(value)}"
                        placeholder="0 or 1"
                    >
                </label>
            `;
        })
        .join('');

    refs.inspectorPanel.innerHTML = `
        <div class="inspector-card">
            <span class="pill">State</span>
            <h3>${escapeHtml(state.label)}</h3>
            <p>Adjust the state label, mark it as initial, or edit Moore outputs.</p>

            <div class="field-grid">
                <label class="field">
                    <span>Label</span>
                    <input
                        type="text"
                        data-action="set-state-label"
                        value="${escapeHtml(state.label)}"
                    >
                </label>
                ${outputsMarkup}
            </div>

            <div class="action-row">
                ${
                    state.isInitial
                        ? '<span class="pill success">Initial state</span>'
                        : '<button class="inline-button" type="button" data-action="make-initial">Set as initial</button>'
                }
                <button class="inline-button danger" type="button" data-action="delete-state">Delete state</button>
            </div>

            <div class="meta-grid">
                <div>
                    <span>ID</span>
                    <strong>${escapeHtml(state.id)}</strong>
                </div>
                <div>
                    <span>Outgoing transitions</span>
                    <strong>${machine.transitionsFrom(state.id).length}</strong>
                </div>
                <div>
                    <span>X position</span>
                    <strong>${Math.round(state.x)}</strong>
                </div>
                <div>
                    <span>Y position</span>
                    <strong>${Math.round(state.y)}</strong>
                </div>
            </div>
        </div>
    `;
}

// Transition editing UI: currently focused on the input pattern because this POC
// primarily demonstrates Moore machines.
function renderTransitionInspector(transition) {
    const fromState = machine.getState(transition.from);
    const toState = machine.getState(transition.to);

    refs.inspectorPanel.innerHTML = `
        <div class="inspector-card">
            <span class="pill">Transition</span>
            <h3>${escapeHtml(fromState?.label || transition.from)} -> ${escapeHtml(toState?.label || transition.to)}</h3>
            <p>Update the input pattern or remove the transition.</p>

            <div class="field-grid">
                <label class="field">
                    <span>Input pattern</span>
                    <input
                        type="text"
                        inputmode="numeric"
                        data-action="set-transition-input"
                        value="${escapeHtml(transition.input)}"
                    >
                </label>
                <div class="inline-meta">
                    <div>
                        <span>Machine type</span>
                        <strong>${escapeHtml(machine.type.toUpperCase())}</strong>
                    </div>
                    <div>
                        <span>Transition ID</span>
                        <strong>${escapeHtml(transition.id)}</strong>
                    </div>
                </div>
            </div>

            <div class="action-row">
                <button class="inline-button danger" type="button" data-action="delete-transition">Delete transition</button>
            </div>
        </div>
    `;
}

// Inspector button actions are routed here after the user clicks inside the panel.
function handleInspectorClick(event) {
    const action = event.target.dataset.action;
    const selection = editor.getSelection();

    if (!action || !selection || !selection.item) {
        return;
    }

    if (action === 'make-initial' && selection.type === 'state') {
        machine.setInitialState(selection.item.id);
        editor.render();
        renderInspector();
        markResultsStale();
        setStatus(`${selection.item.label} is now the initial state.`);
        return;
    }

    if (action === 'delete-state' && selection.type === 'state') {
        const label = selection.item.label;
        machine.removeState(selection.item.id);
        editor.clearSelection();
        renderMachineStats();
        renderInspector();
        markResultsStale();
        setStatus(`Removed state ${label}.`);
        return;
    }

    if (action === 'delete-transition' && selection.type === 'transition') {
        machine.removeTransition(selection.item.id);
        editor.clearSelection();
        renderMachineStats();
        renderInspector();
        markResultsStale();
        setStatus('Removed transition.');
    }
}

// Inspector form changes are routed here and then delegated by selection type.
function handleInspectorChange(event) {
    const action = event.target.dataset.action;
    const selection = editor.getSelection();

    if (!action || !selection || !selection.item) {
        return;
    }

    if (selection.type === 'state') {
        handleStateInspectorChange(action, event.target, selection.item);
        return;
    }

    handleTransitionInspectorChange(action, event.target, selection.item);
}

// State inputs can rename the state or modify its Moore outputs.
function handleStateInspectorChange(action, target, state) {
    if (action === 'set-state-label') {
        const nextLabel = target.value.trim();
        state.label = nextLabel || state.id;
        editor.render();
        renderInspector();
        markResultsStale();
        setStatus(`Renamed ${state.id} to ${state.label}.`);
        return;
    }

    if (action === 'set-state-output') {
        const outputName = target.dataset.name;
        const rawValue = target.value.trim();

        if (!outputName) {
            return;
        }

        if (rawValue === '') {
            delete state.outputs[outputName];
            target.value = '';
        } else {
            state.setOutput(outputName, coerceBit(rawValue));
            target.value = String(state.outputs[outputName]);
        }

        editor.render();
        markResultsStale();
        setStatus(`Updated ${state.label} output ${outputName}.`);
    }
}

// Transition inputs are sanitized to the active input width before being saved.
function handleTransitionInspectorChange(action, target, transition) {
    if (action !== 'set-transition-input') {
        return;
    }

    const normalized = normalizeBitPattern(target.value, machine.inputNames.length);
    if (!normalized) {
        target.value = transition.input;
        setStatus(`Input patterns must be ${machine.inputNames.length} binary bit(s).`);
        return;
    }

    transition.input = normalized;
    target.value = normalized;
    editor.render();
    markResultsStale();
    setStatus('Updated transition input.');
}

// Run validation first, then the full synthesis pipeline only if the FSM is valid.
function synthesizeCurrentMachine() {
    const validation = machine.validate();

    if (!validation.valid) {
        refs.resultsPanel.dataset.mode = 'validation';
        refs.resultsPanel.innerHTML = renderValidationOnly(validation);
        setStatus('Validation failed. Resolve the issues and try again.');
        return;
    }

    const report = runSynthesis(machine);
    refs.resultsPanel.dataset.mode = 'report';
    refs.resultsPanel.innerHTML = renderReport(validation, report);
    setStatus('Synthesis complete.');
}

// When the FSM is invalid, render only the problems that block synthesis.
function renderValidationOnly(validation) {
    const warningsMarkup = validation.warnings.length
        ? `
            <div class="result-card">
                <h3>Warnings</h3>
                <ul class="message-list warning">
                    ${validation.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}
                </ul>
            </div>
        `
        : '';

    return `
        <div class="result-card">
            <h3>Validation failed</h3>
            <ul class="message-list error">
                ${validation.errors.map((error) => `<li>${escapeHtml(error)}</li>`).join('')}
            </ul>
        </div>
        ${warningsMarkup}
    `;
}

// This builds the multi-stage report card view shown after synthesis.
function renderReport(validation, report) {
    const encodingRows = report.encoding.ordered
        .map(
            (item) => `
                <tr>
                    <td class="left">${escapeHtml(item.label)}</td>
                    <td>${escapeHtml(item.code)}</td>
                </tr>
            `
        )
        .join('');

    const transitionHeaderCells = [
        ...report.table.columns.currentState,
        ...report.table.columns.inputs,
        ...report.table.columns.nextState,
        ...report.table.columns.outputs,
    ]
        .map((name) => `<th>${escapeHtml(name)}</th>`)
        .join('');

    const transitionRows = report.table.rows
        .map((row) => {
            const rowClass = row.isDontCare ? ' class="dont-care"' : '';
            const cells = [
                row.rowIndex,
                ...row.currentState.split(''),
                ...row.input.split(''),
                ...row.nextState.split(''),
                ...row.output.split(''),
            ]
                .map((value, index) =>
                    index === 0 ? `<td>${value}</td>` : `<td>${escapeHtml(value)}</td>`
                )
                .join('');

            return `<tr${rowClass}>${cells}</tr>`;
        })
        .join('');

    const functionRows = report.functions
        .map(
            (fn) => `
                <tr>
                    <td class="left">${escapeHtml(fn.name)}</td>
                    <td class="left">${escapeHtml(formatNumberList(fn.minterms))}</td>
                    <td class="left">${escapeHtml(formatNumberList(fn.dontCares))}</td>
                </tr>
            `
        )
        .join('');

    const equationMarkup = report.minimized
        .map(
            (item) => `
                <div class="equation-chip">
                    <strong>${escapeHtml(item.name)}</strong> = ${escapeHtml(item.expression)}
                </div>
            `
        )
        .join('');

    const warningsMarkup = validation.warnings.length
        ? `
            <div class="result-card">
                <h3>Warnings</h3>
                <ul class="message-list warning">
                    ${validation.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}
                </ul>
            </div>
        `
        : '';

    return `
        ${warningsMarkup}

        <div class="result-card">
            <h3>FSM Definition</h3>
            <div class="inline-summary">
                <span class="chip">Type: ${escapeHtml(machine.type.toUpperCase())}</span>
                <span class="chip">States: ${machine.states.length}</span>
                <span class="chip">Transitions: ${machine.transitions.length}</span>
                <span class="chip">Inputs: ${escapeHtml(joinNames(machine.inputNames))}</span>
                <span class="chip">Outputs: ${escapeHtml(joinNames(machine.outputNames))}</span>
            </div>
            <p>The current machine snapshot is shown below.</p>
            <details>
                <summary>Show JSON</summary>
                <pre>${escapeHtml(JSON.stringify(machine.toJSON(), null, 2))}</pre>
            </details>
        </div>

        <div class="result-card">
            <h3>State Encoding</h3>
            <p>
                Flip-flops needed: <strong>${report.encoding.numBits}</strong>
            </p>
            <table class="data-table">
                <thead>
                    <tr>
                        <th class="left">State</th>
                        <th>Code</th>
                    </tr>
                </thead>
                <tbody>
                    ${encodingRows}
                </tbody>
            </table>
            <p class="result-note">Unused codes: ${escapeHtml(formatNumberList(report.encoding.unusedCodes))}</p>
        </div>

        <div class="result-card">
            <h3>Transition Table</h3>
            <p>
                Total rows: <strong>${report.table.totalRows}</strong>.
                Don't-care rows: <strong>${report.table.dontCareRows}</strong>.
            </p>
            <table class="data-table">
                <thead>
                    <tr>
                        <th>#</th>
                        ${transitionHeaderCells}
                    </tr>
                </thead>
                <tbody>
                    ${transitionRows}
                </tbody>
            </table>
        </div>

        <div class="result-card">
            <h3>Equation Derivation</h3>
            <p>Variables are ordered as: ${escapeHtml(joinNames(report.variableNames))}</p>
            <table class="data-table">
                <thead>
                    <tr>
                        <th class="left">Function</th>
                        <th class="left">Minterms</th>
                        <th class="left">Don't cares</th>
                    </tr>
                </thead>
                <tbody>
                    ${functionRows}
                </tbody>
            </table>
        </div>

        <div class="result-card">
            <h3>Minimized Equations</h3>
            <div class="equation-list">
                ${equationMarkup}
            </div>
        </div>
    `;
}

// Placeholder content keeps the report area useful even before synthesis has run.
function renderResultsPlaceholder(message = 'Build a machine and run Synthesize to see the logic report.') {
    refs.resultsPanel.dataset.mode = 'placeholder';
    refs.resultsPanel.innerHTML = `
        <div class="placeholder-card">
            <h3>Ready for synthesis</h3>
            <p>${escapeHtml(message)}</p>
        </div>
    `;
}

// Existing results stay visible after edits, but this note tells the user that
// they are now looking at stale output from an older machine revision.
function markResultsStale() {
    if (refs.resultsPanel.dataset.mode !== 'report') {
        return;
    }

    if (refs.resultsPanel.querySelector('.stale-note')) {
        return;
    }

    refs.resultsPanel.insertAdjacentHTML(
        'afterbegin',
        '<div class="stale-note">The diagram changed after the last synthesis. Run Synthesize again to refresh the report.</div>'
    );
}

// Reset the FSM and restore the default one-input/one-output setup used by
// the basic sequence detector example and by the empty canvas.
function resetMachineConfiguration({
    inputNames = ['X'],
    outputNames = ['Z'],
    machineType = 'moore',
} = {}) {
    machine.reset();
    machine.type = machineType;
    machine.inputNames = [...inputNames];
    machine.outputNames = [...outputNames];
}

// Example 1: a small Moore sequence detector for the pattern "01".
function loadSequenceExample() {
    resetMachineConfiguration({
        inputNames: ['X'],
        outputNames: ['Z'],
    });

    const s0 = machine.addState(150, 260);
    s0.setOutputs({ Z: 0 });

    const s1 = machine.addState(370, 160);
    s1.setOutputs({ Z: 0 });

    const s2 = machine.addState(570, 260);
    s2.setOutputs({ Z: 1 });

    machine.setInitialState(s0.id);

    machine.addTransition(s0.id, s1.id, '0');
    machine.addTransition(s0.id, s0.id, '1');
    machine.addTransition(s1.id, s1.id, '0');
    machine.addTransition(s1.id, s2.id, '1');
    machine.addTransition(s2.id, s1.id, '0');
    machine.addTransition(s2.id, s0.id, '1');

    editor.clearSelection();
    editor.render();
    renderMachineStats();
    renderInspector();
}

// Example 2: a simple traffic light controller.
// Input T acts like a timer/tick signal:
// 0 = stay in the current light
// 1 = advance to the next light
function loadTrafficLightExample() {
    resetMachineConfiguration({
        inputNames: ['T'],
        outputNames: ['R', 'Y', 'G'],
    });

    const red = machine.addState(170, 250);
    red.label = 'Red';
    red.setOutputs({ R: 1, Y: 0, G: 0 });

    const green = machine.addState(400, 120);
    green.label = 'Green';
    green.setOutputs({ R: 0, Y: 0, G: 1 });

    const yellow = machine.addState(620, 250);
    yellow.label = 'Yellow';
    yellow.setOutputs({ R: 0, Y: 1, G: 0 });

    machine.setInitialState(red.id);

    machine.addTransition(red.id, red.id, '0');
    machine.addTransition(red.id, green.id, '1');
    machine.addTransition(green.id, green.id, '0');
    machine.addTransition(green.id, yellow.id, '1');
    machine.addTransition(yellow.id, yellow.id, '0');
    machine.addTransition(yellow.id, red.id, '1');

    editor.clearSelection();
    editor.render();
    renderMachineStats();
    renderInspector();
}
