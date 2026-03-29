# FSM Logic - POC

A browser-based tool for turning a finite state machine into Boolean logic equations.

Nothing fancy. You draw a machine, hit synthesize, and watch it break down into encoded states, a transition table, and minimized expressions. The goal was to make that whole process feel less like a black box.

---

## What it does

You start by drawing an FSM on a canvas add states, connect them with transitions, label your inputs and outputs. Once you're happy with the diagram, you run synthesis and the app walks you through every stage: how states get encoded into bits, how the transition table gets filled in, and how the final Boolean equations fall out.

There are two built-in examples if you just want to poke around:

- **Sequence detector** - detects the pattern `01`. Small, clean, good for understanding state encoding.
- **Traffic light controller** - cycles through Red → Green → Yellow based on a timer input `T`. Shows how multiple outputs (`R`, `Y`, `G`) are handled.

---


## Drawing your FSM

**On the canvas:**

| Action | What it does |
|--------|--------------|
| Double-click empty space | Adds a new state |
| Drag a state | Moves it around |
| Shift + drag from one state to another | Creates a transition |
| Click a state or transition | Opens it in the inspector |
| `Escape` | Deselects everything |

**In the inspector (right side panel):**

When you click a state, you can rename it, set Moore outputs, mark it as the initial state, or delete it.

When you click a transition, you can edit the input bit pattern or delete it.

---

## Running synthesis

Click **Synthesize** once your FSM looks right.

If something's off - missing initial state, duplicate names, conflicting transitions - the app will tell you what's wrong before doing anything.

If everything checks out, it steps through:

1. **FSM definition** - a summary of what you drew
2. **State encoding** - assigns binary codes to each state (2 states → 1 bit, 3–4 → 2 bits, and so on)
3. **Transition table** - expands every state + input combination into next-state and output bits
4. **Equation derivation** - pulls minterms and don't-cares for each output bit
5. **Minimized Boolean equations** - runs Quine-McCluskey and gives you the final Sum of Products expressions

Example output for a sequence detector:

```
Q0+ = Q1 · X
Q1+ = X'
Z   = Q0
```

---

## How the synthesis actually works

**Validation** comes first - the app checks that the FSM is complete and consistent before touching any logic.

**State encoding** maps symbolic names to binary. Don't-care codes (unused state encodings) carry into the minimization step and help simplify the equations.

**The transition table** is essentially a truth table for the machine. Every valid combination of current state bits and input bits gets a row. Missing or unused combinations become don't-cares.

**Boolean minimization** uses a Quine-McCluskey approach - grouped by number of 1s, checked for single-bit differences, and reduced until you have clean prime implicants.

---

## Project layout

```
index.html          - page structure
style.css           - all the styling
src/
  main.js           - wires up the UI, examples, and synthesis flow
  fsm.js            - state/transition model and validation
  editor.js         - canvas drawing and interaction
  synthesizer.js    - encoding, table generation, minimization
  utils.js          - small helpers
```

---

## Current limits

This is a proof of concept, so a few things are intentionally left out:

- It stops at Boolean equations - no HDL output, no netlist, no actual circuit
- Mealy-style machines aren't the focus; this is built around Moore outputs
- Transition input entry still uses a prompt dialog (planned to improve)
- No undo/redo yet

---

## Why this exists

FSM synthesis is one of those topics that looks simple on paper but gets confusing fast when you're staring at a blank transition table wondering where the equations come from.

This tool tries to show the full path - from diagram to encoding to table to minimized logic - in one place, without jumping between textbook examples and a separate tool. If you're learning this for the first time, hopefully it makes the process feel a bit more concrete.
