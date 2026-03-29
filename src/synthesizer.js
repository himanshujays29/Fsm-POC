import { bitsForCount, toBitString } from './utils.js';

// Run the full FSM -> Boolean equation pipeline and return all intermediate data
// so the UI can show every synthesis stage.
export function runSynthesis(machine) {
    const encoding = encodeStates(machine);
    const table = buildTransitionTable(machine, encoding);
    const functions = deriveBooleanFunctions(table, machine);
    const variableNames = [
        ...Array.from({ length: encoding.numBits }, (_, index) => `Q${index}`),
        ...machine.inputNames,
    ];

    const minimized = functions.map((fn) => {
        const implicants = minimizeBooleanExpression(fn.numVars, fn.minterms, fn.dontCares);
        return {
            ...fn,
            implicants,
            expression: toSumOfProducts(implicants, variableNames),
        };
    });

    return {
        encoding,
        table,
        functions,
        minimized,
        variableNames,
    };
}

// Assign binary codes to states in declaration order.
export function encodeStates(machine) {
    const numStates = machine.states.length;
    const numBits = bitsForCount(numStates);
    const map = {};
    const byCode = {};
    const ordered = [];

    machine.states.forEach((state, index) => {
        const code = toBitString(index, numBits);
        map[state.id] = code;
        byCode[code] = state.id;
        ordered.push({
            id: state.id,
            label: state.label,
            code,
        });
    });

    const unusedCodes = [];
    const totalCodes = Math.pow(2, numBits);
    for (let value = 0; value < totalCodes; value += 1) {
        const code = toBitString(value, numBits);
        if (!byCode[code]) {
            unusedCodes.push(code);
        }
    }

    return {
        numStates,
        numBits,
        map,
        byCode,
        ordered,
        unusedCodes,
    };
}

// Expand the FSM into a complete transition table across every state/input combination.
export function buildTransitionTable(machine, encoding) {
    const numStateBits = encoding.numBits;
    const numInputBits = machine.inputNames.length;
    const numOutputBits = machine.outputNames.length;
    const rows = [];
    const unusedCodeSet = new Set(encoding.unusedCodes);
    const totalStateCombinations = Math.pow(2, numStateBits);
    const totalInputCombinations = Math.pow(2, numInputBits);

    for (let stateValue = 0; stateValue < totalStateCombinations; stateValue += 1) {
        const currentState = toBitString(stateValue, numStateBits);

        for (let inputValue = 0; inputValue < totalInputCombinations; inputValue += 1) {
            const input = toBitString(inputValue, numInputBits);
            const rowIndex = parseInt(currentState + input, 2);

            if (unusedCodeSet.has(currentState)) {
                rows.push({
                    rowIndex,
                    currentState,
                    input,
                    nextState: 'X'.repeat(numStateBits),
                    output: 'X'.repeat(numOutputBits),
                    isDontCare: true,
                });
                continue;
            }

            const currentStateId = encoding.byCode[currentState];
            const transition = machine.transitions.find(
                (edge) => edge.from === currentStateId && edge.input === input
            );

            if (!transition) {
                rows.push({
                    rowIndex,
                    currentState,
                    input,
                    nextState: 'X'.repeat(numStateBits),
                    output: 'X'.repeat(numOutputBits),
                    isDontCare: true,
                });
                continue;
            }

            const nextState = encoding.map[transition.to];
            const output = machine.outputNames
                .map((name) => {
                    if (machine.type === 'moore') {
                        const state = machine.getState(currentStateId);
                        return String(state?.outputs[name] ?? 0);
                    }

                    return String(transition.outputs[name] ?? 0);
                })
                .join('');

            rows.push({
                rowIndex,
                currentState,
                input,
                nextState,
                output,
                isDontCare: false,
            });
        }
    }

    return {
        numStateBits,
        numInputBits,
        numOutputBits,
        rows,
        totalRows: rows.length,
        dontCareRows: rows.filter((row) => row.isDontCare).length,
        columns: {
            currentState: Array.from({ length: numStateBits }, (_, index) => `Q${index}`),
            inputs: [...machine.inputNames],
            nextState: Array.from({ length: numStateBits }, (_, index) => `Q${index}+`),
            outputs: [...machine.outputNames],
        },
    };
}

// Convert the transition table into one Boolean function per next-state bit and output bit.
export function deriveBooleanFunctions(table, machine) {
    const functions = [];
    const numVars = table.numStateBits + table.numInputBits;

    for (let bitIndex = 0; bitIndex < table.numStateBits; bitIndex += 1) {
        functions.push(
            extractFunctionData({
                rows: table.rows,
                columnName: `Q${bitIndex}+`,
                numVars,
                bitIndex,
                selectColumn: (row) => row.nextState,
            })
        );
    }

    for (let bitIndex = 0; bitIndex < table.numOutputBits; bitIndex += 1) {
        functions.push(
            extractFunctionData({
                rows: table.rows,
                columnName: machine.outputNames[bitIndex] || `Z${bitIndex}`,
                numVars,
                bitIndex,
                selectColumn: (row) => row.output,
            })
        );
    }

    return functions;
}

// Pull minterms and don't-cares out of one table column.
function extractFunctionData({ rows, columnName, numVars, bitIndex, selectColumn }) {
    const minterms = [];
    const dontCares = [];

    for (const row of rows) {
        const column = selectColumn(row);
        const value = column[bitIndex];

        if (row.isDontCare || value === 'X') {
            dontCares.push(row.rowIndex);
        } else if (value === '1') {
            minterms.push(row.rowIndex);
        }
    }

    return {
        name: columnName,
        numVars,
        minterms,
        dontCares,
    };
}

// Small Quine-McCluskey style reducer used for this proof-of-concept.
export function minimizeBooleanExpression(numVars, minterms, dontCares = []) {
    if (minterms.length === 0) {
        return [];
    }

    const totalPossible = Math.pow(2, numVars);
    if (minterms.length === totalPossible) {
        return ['-'.repeat(numVars)];
    }

    const allTerms = [...new Set([...minterms, ...dontCares])].sort((a, b) => a - b);
    let current = allTerms.map((term) => ({
        pattern: toBitString(term, numVars),
        used: false,
    }));
    const primeMap = new Map();

    while (current.length > 0) {
        const nextMap = new Map();

        for (const item of current) {
            item.used = false;
        }

        for (let i = 0; i < current.length; i += 1) {
            for (let j = i + 1; j < current.length; j += 1) {
                const mergedPattern = mergePatterns(current[i].pattern, current[j].pattern);
                if (!mergedPattern) {
                    continue;
                }

                current[i].used = true;
                current[j].used = true;

                if (!nextMap.has(mergedPattern)) {
                    nextMap.set(mergedPattern, {
                        pattern: mergedPattern,
                        used: false,
                    });
                }
            }
        }

        for (const item of current) {
            if (!item.used) {
                primeMap.set(item.pattern, item.pattern);
            }
        }

        current = [...nextMap.values()];
    }

    const primeImplicants = [...primeMap.values()];
    return selectImplicants(numVars, minterms, primeImplicants);
}

// Combine two implicants only when they differ in exactly one concrete bit.
function mergePatterns(a, b) {
    let diffCount = 0;
    let merged = '';

    for (let index = 0; index < a.length; index += 1) {
        if (a[index] === b[index]) {
            merged += a[index];
            continue;
        }

        if (a[index] === '-' || b[index] === '-') {
            return null;
        }

        diffCount += 1;
        if (diffCount > 1) {
            return null;
        }

        merged += '-';
    }

    return diffCount === 1 ? merged : null;
}

// Choose a covering set of implicants: first essentials, then a greedy pass.
function selectImplicants(numVars, minterms, primeImplicants) {
    const selected = [];
    const uncovered = new Set(minterms);

    for (const minterm of minterms) {
        const covering = primeImplicants.filter((pattern) =>
            patternCoversMinterm(pattern, minterm, numVars)
        );

        if (covering.length === 1 && !selected.includes(covering[0])) {
            selected.push(covering[0]);
            removeCoveredMinterms(covering[0], uncovered, numVars);
        }
    }

    while (uncovered.size > 0) {
        let bestPattern = null;
        let bestCoverage = 0;
        let bestSpecificity = Number.POSITIVE_INFINITY;

        for (const pattern of primeImplicants) {
            if (selected.includes(pattern)) {
                continue;
            }

            let coverage = 0;
            for (const minterm of uncovered) {
                if (patternCoversMinterm(pattern, minterm, numVars)) {
                    coverage += 1;
                }
            }

            const specificity = pattern.split('').filter((char) => char !== '-').length;

            if (
                coverage > bestCoverage ||
                (coverage === bestCoverage && coverage > 0 && specificity < bestSpecificity)
            ) {
                bestPattern = pattern;
                bestCoverage = coverage;
                bestSpecificity = specificity;
            }
        }

        if (!bestPattern) {
            break;
        }

        selected.push(bestPattern);
        removeCoveredMinterms(bestPattern, uncovered, numVars);
    }

    return selected;
}

// Check whether a pattern like 1-0 covers a specific minterm.
function patternCoversMinterm(pattern, minterm, numVars) {
    const bits = toBitString(minterm, numVars);
    for (let index = 0; index < pattern.length; index += 1) {
        if (pattern[index] !== '-' && pattern[index] !== bits[index]) {
            return false;
        }
    }
    return true;
}

// Remove every minterm already handled by a chosen implicant.
function removeCoveredMinterms(pattern, uncovered, numVars) {
    for (const minterm of [...uncovered]) {
        if (patternCoversMinterm(pattern, minterm, numVars)) {
            uncovered.delete(minterm);
        }
    }
}

// Turn one implicant into a readable product term.
export function implicantToExpression(pattern, variableNames) {
    const factors = [];

    for (let index = 0; index < pattern.length; index += 1) {
        const char = pattern[index];
        const variable = variableNames[index] || `x${index}`;

        if (char === '1') {
            factors.push(variable);
        } else if (char === '0') {
            factors.push(`${variable}'`);
        }
    }

    return factors.length > 0 ? factors.join(' * ') : '1';
}

// Join product terms into the SOP expression shown in the report.
export function toSumOfProducts(implicants, variableNames) {
    if (implicants.length === 0) {
        return '0';
    }

    return implicants
        .map((pattern) => implicantToExpression(pattern, variableNames))
        .join(' + ');
}
