export const END = '__end__'

type NodeFn<S> = (state: S) => Promise<Partial<S>>
type RouterFn<S> = (state: S) => string

interface NodeDef<S> {
  fn: NodeFn<S>
}

interface ConditionalEdge<S> {
  router: RouterFn<S>
}

export class StateGraph<S extends Record<string, unknown>> {
  private nodes = new Map<string, NodeDef<S>>()
  private edges = new Map<string, string>()
  private conditionalEdges = new Map<string, ConditionalEdge<S>>()
  private entryPoint: string | null = null

  addNode(name: string, fn: NodeFn<S>): this {
    this.nodes.set(name, { fn })
    return this
  }

  addEdge(from: string, to: string): this {
    this.edges.set(from, to)
    return this
  }

  addConditionalEdge(from: string, router: RouterFn<S>): this {
    this.conditionalEdges.set(from, { router })
    return this
  }

  setEntryPoint(name: string): this {
    this.entryPoint = name
    return this
  }

  async run(
    initialState: S,
    opts?: {
      onNodeStart?: (name: string, state: S) => void
      onNodeEnd?: (name: string, state: S, partial: Partial<S>) => void
      maxSteps?: number
    },
  ): Promise<S> {
    if (!this.entryPoint) throw new Error('No entry point set')

    let state = { ...initialState }
    let currentNode = this.entryPoint
    let steps = 0
    const maxSteps = opts?.maxSteps ?? 50

    while (currentNode !== END) {
      if (steps++ > maxSteps) {
        throw new Error(`Graph exceeded max steps (${maxSteps}). Possible infinite loop.`)
      }

      const nodeDef = this.nodes.get(currentNode)
      if (!nodeDef) throw new Error(`Unknown node: ${currentNode}`)

      opts?.onNodeStart?.(currentNode, state)

      const partial = await nodeDef.fn(state)
      state = { ...state, ...partial }

      opts?.onNodeEnd?.(currentNode, state, partial)

      const conditional = this.conditionalEdges.get(currentNode)
      if (conditional) {
        currentNode = conditional.router(state)
      } else {
        currentNode = this.edges.get(currentNode) ?? END
      }
    }

    return state
  }
}
