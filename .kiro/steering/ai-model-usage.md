# AI Model Usage Rules

## Model Selection

- **Planning & Analysis** (tạo plan, phân tích dự án, viết requirements, design, review architecture):  
  Use `AI_PLANNING_MODEL` → `claude-opus-4-6`

- **Task Execution** (implement code, fix bugs, run tasks):  
  Use the default Sonnet model (`claude-sonnet-4-6`)

## Environment Variable

The backend defines `AI_PLANNING_MODEL=claude-opus-4-6` in `.env`.

When calling the AI service for planning/analysis tasks (e.g., generating architecture plans, analyzing project structure, writing spec documents), always select the model from `AI_PLANNING_MODEL`.

For all other code generation and task execution, use the standard model.
