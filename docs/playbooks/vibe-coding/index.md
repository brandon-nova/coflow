
**“Writing High Quality Production Code with LLMs is a Solved Problem”**


**Core claim:** Quality production code with LLMs is feasible, but only if you stop treating them like magic and treat them like tools. Most failures with LLMs come from poor workflow, not model capability.

1. **Constant Refactors → Fix with Structured Conversation**
    1. Explain the problem in detail.
        1. Ask the model to **propose approaches first** (no code).
        2. Review alternatives and tradeoffs.
        3. Convert the approved approach into a mini-spec.
        4. Break into atomic tasks.
        5. Generate code task-by-task.

    Key idea: Writing code should be the last step. LLMs amplify engineering judgment—they don’t replace it.

2. **Lack of Context → Fix with Ramp-Up**

    Treat the model like a new hire.

    - Have it crawl the repo and generate documentation.
    - Create internal summaries in a /docs folder.
    - Summarize third-party docs for relevant libraries.
    - Use system prompts (e.g., AGENTS.md, CLAUDE.md) to encode:
        - Coding standards
        - Architecture patterns
        - Anti-patterns to avoid

    Result: reusable “engineering brain” loaded each session.

3. **Poor Instruction Following → Fix with Better Models + Context Management**

    Not all models are equal.

    - Instruction fidelity matters more than raw coding ability.
    - Use higher-tier reasoning modes (e.g., “high” reasoning variants).

    **Context Window Management:**

    - Use /compact or write handoff documents.
    - Long sessions degrade quality. Reset sessions when needed.
4. **Doom Loops → Fix with Debug-First Workflow**

    **Solution: Separate debugging from coding.**


    Instead of: “Fix this error.”


    Say: “Investigate. Do not code. Report findings and possible fixes.”


    Only allow code generation after root cause found.

5. **Complexity Limits → Fix with Decomposition**

    LLMs fail when asked to build large systems in one shot.


    **Solution: Break everything into atomic tasks.**

    - Conversation → Spec → Task List
    - Execute one isolated task at a time
    - Each task acts as a “complexity shield”

    The model lays one brick at a time

