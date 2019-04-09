import * as lodash from "lodash"
// import * as jtree from "jtree"
const jtree = require("jtree")

declare type scope = string
declare type contextPath = string // Ie:  Packages/JavaScript/JavaScript.sublime-syntax
declare type statementType =
  | "match"
  | "meta_scope"
  | "include"
  | "meta_content_scope"
  | "contextPath"
  | "meta_include_prototype"
  | "clear_scopes"
declare type contextName = string

interface ContextStatement {}

//const dates: Date[] = [1, new Date()].filter(num => num instanceof Date)

class MetaScope implements ContextStatement {}

class EmbedStatement implements ContextStatement {
  public escape: RegExp
  public embed_scope: scope
  public escape_captures: { [index0plus: number]: scope } = {} // Use capture group 0 to apply a scope to the entire escape match.
}

interface MatchResult {
  start: number
  end: number
  text: string
  captured: string[]
  matchNode: MatchNode

  usedRegString: string
  usedLine: string
  usedBackReferences: string[]
}

/*
Note on RegExpExecArray:
https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/exec
If the match succeeds, the exec() method returns an array and updates properties of the
regular expression object. The returned array has the matched text as the first item, and
then one item for each capturing parenthesis that matched containing the text that was captured.
*/

class MatchNode extends jtree.NonTerminalNode implements ContextStatement {
  // Note that the actions: push, pop, set and embed are exclusive, and only one of
  // them may be used within a single match pattern.
  public push: contextName | contextPath | contextName[] | ContextStatement
  public set: contextName | contextPath | contextName[] | ContextStatement
  public pop: boolean // Can only be true

  // When a context has multiple patterns, the leftmost one will be found.
  // When multiple patterns match at the same position, the first defined pattern will be selected.
  public match: RegExp
  public scope: scope
  public captures: { [index1plus: number]: scope } = {}
  public embed: contextName

  public getScopes(state: State): scope[] {
    const scopes = state.getScopeChain()

    // If its a pop, dont include meta_content_scope of parent context.
    if (this.get("pop") === "true" && state.currentContext.has("meta_content_scope")) scopes.pop()

    const newScopes = this.has("scope") ? this.get("scope").split(" ") : []
    return scopes.concat(newScopes)
  }

  /* This contains a list of patterns that will be inserted into every context
  defined within JavaScript.sublime-syntax. Note that with_prototype is conceptually
  similar to the prototype context, however it will be always be inserted into every
  referenced context irrespective of their meta_include_prototype setting.*/
  public with_prototype: ContextNode

  public getReg(state: State): string {
    let reg = this.getContent()
    const backReferences = state.getBackReferences()

    if (backReferences.length === 0 && reg.match(/\\\d/))
      state.logError(
        `Expected a backreference(s) in '${reg}' but none passed. Current context '${state.currentContext.getId()}'. Parent contexts: '${state.getContextChain()}' .`,
        backReferences
      )

    // replace back references
    for (let index = 0; index < backReferences.length; index++) {
      let re2 = new RegExp(`\\\\${index + 1}`, "g")
      reg = reg.replace(re2, backReferences[index])
    }

    return reg
  }

  public testLine(line: string, state: State, consumed: number): MatchResult[] {
    let match: RegExpExecArray
    let matches: MatchResult[] = []

    let reg = this.getReg(state)
    let re = new RegExp(reg, "g")

    // Only should break for lookbehinds?
    //line = line.substr(consumed)
    // This will start things at consumed, but allow for lookbehinds.
    re.lastIndex = consumed
    const backRefs = state.getBackReferences()

    let startChar = -1
    while ((match = re.exec(line)) !== null) {
      // protect against infinite loops, ie if regex is ^
      if (match.index > startChar) startChar = match.index
      else break

      const text = match[0]
      const captured = []
      let index = 1
      while (match[index] !== undefined) {
        captured.push(match[index])
        state.log(`Saving backreference '${match[index]}' from reg '${reg}' in line '${line}'`)
        index++
      }
      const result: MatchResult = {
        start: match.index,
        end: text.length + match.index,
        text: text,
        captured: captured,
        matchNode: this,
        usedRegString: reg,
        usedBackReferences: backRefs,
        usedLine: line
      }
      matches.push(result)
    }

    // if (matches.length) state.log(`'${line}' matched '${reg}'`, matches)
    // else state.log(`'${line}' no match on '${reg}'`)

    return matches
  }
}

class Include implements ContextStatement {}

class ContextNode extends jtree.NonTerminalNode {
  public id: contextName
  public items: ContextStatement[]

  isMain() {
    return this.getId() === "main"
  }

  getId() {
    return this.getKeyword()
  }

  // META PATTERNS:
  // Meta patterns must be listed first in the context, before any match or include patterns.

  // This assigns the given scope to all text within this context,
  // including the patterns that push the context onto the stack and pop it off.
  public meta_scope: string

  public meta_content_scope: string // As above, but does not apply to the text that
  // triggers the context (e.g., in the above string example, the content scope would not
  // get applied to the quote characters).

  // Used to stop the current context from automatically including the prototype context.
  public meta_include_prototype: boolean

  // This setting allows removing scope names from the current stack.
  // It can be an integer, or the value true to remove all scope names.
  // It is applied before meta_scope and meta_content_scope.
  // This is typically only used when one syntax is embedding another.
  public clear_scopes: boolean | number

  getExpanded() {
    // todo: add includes and prototypes
    return this.items
  }

  _testLineAgainstAllMatchesAndGetSortedResults(state: State, consumed: number) {
    const allMatchResults: MatchResult[][] = this.getChildrenByNodeType(MatchNode).map(node =>
      (<MatchNode>node).testLine(state.currentLine, state, consumed)
    )

    // Sort by left most.
    return lodash.sortBy(lodash.flatten(allMatchResults), ["start"])
  }

  handle(state: State, spans, consumed = 0): number {
    const line = state.currentLine
    // Sort by left most.
    const sortedMatches = this._testLineAgainstAllMatchesAndGetSortedResults(state, consumed)
    const len = line.length
    state.log(
      `context '${this.getKeyword()}' handling '${line}'. Part: '${line.substr(consumed)}'. ${
        sortedMatches.length
      } matches for '${line}'`
    )
    while (consumed <= len && sortedMatches.length) {
      const nextMatch = sortedMatches.shift()

      // state.log(`match '${nextMatch.text}' starts on position ${nextMatch.start} and consumed is ${consumed}`)

      if (nextMatch.start < consumed) {
        state.log(
          `for match '${nextMatch.text}' and reg '${nextMatch.matchNode.getReg(state)}', nextMatch.start is ${
            nextMatch.start
          } and consumed is ${consumed}, continuing loop.`
        )
        state.log("for some reason start is less than consumed. why? note this in code.")
        continue
      }

      // add skipped matches:
      if (nextMatch.start > consumed) {
        spans.push({
          text: line.substr(consumed, nextMatch.start - consumed),
          scopes: state.getScopeChain()
        })
        state.log(`Added missing span between ${consumed} and ${nextMatch.start}`)
      }

      // Apply match
      const matchNode = nextMatch.matchNode
      const newSpan = {
        text: nextMatch.text,
        scopes: matchNode.getScopes(state)
      }
      spans.push(newSpan)
      const matchObj = matchNode.toObject()
      state.log(`Added new span for '${nextMatch.text}' with scopes '${newSpan.scopes.join(" ")}'`, nextMatch)
      if (matchObj.push) {
        // todo: if there is a metascope, we need to add that scope above.
        consumed = state.pushContexts(matchObj.push, nextMatch.captured, newSpan).handle(state, spans, nextMatch.end)
      } else if (matchObj.push_context) {
        consumed = state
          .pushAnonContext(matchNode.getNode("push_context"), nextMatch.captured, newSpan)
          .handle(state, spans, nextMatch.end)
      } else if (matchObj.set) {
        return state.setContext(matchObj.set, nextMatch.captured, newSpan).handle(state, spans, nextMatch.end)
      } else if (matchObj.set_context) {
        return state
          .setAnonContext(matchNode.getNode("set_context"), nextMatch.captured, newSpan)
          .handle(state, spans, nextMatch.end)
      } else if (matchNode.get("pop") === "true") {
        state.popContext()
        return state.currentContext.handle(state, spans, nextMatch.end)
      } else {
        consumed = nextMatch.end
      }
    }
    // Not sure about this. What about run ons?
    if (consumed < len - 1) {
      state.log("Consumed ${consumed} is less than ${len - 1}. Adding scope.")
      spans.push({
        text: line.substr(consumed),
        scopes: state.getScopeChain()
      })
      consumed = len // Minus 1 or 1?
    }
    //state.log(`handled line. '${line}'`)
    return consumed
  }
}

interface Span {
  text: string
  scopes: scope[]
}

class State {
  private _program: ProgramNode
  private _messageNumber = 0

  private _contextStack: ContextNode[] = []
  private _backReferenceStack: string[][] = []
  public remainingLines: string[]
  public parsedSpans: Span[]
  public currentLine: string
  public captured: string[] // does each match retain its own captured?

  constructor(program: ProgramNode) {
    this._program = program
    this.pushAnonContext(program.getMainContext(), [])
  }

  log(...obj: any) {
    if (this._program.verbose) {
      this._messageNumber++
      console.log(
        `${this._messageNumber}. line: '${this.currentLine}'. context: '${this.getCurrentStackStr()}' `,
        ...obj
      )
    }
  }

  logError(...obj: any) {
    if (this._program.verbose) console.error(this.currentLine + ": ", ...obj)
  }

  getContextChain() {
    return this._contextStack.map(context => context.getId()).join(" ")
  }

  getScopeChain(): string[] {
    const scopes = [this._program.scope]

    this._contextStack.forEach(context => {
      const meta_scope = context.get("meta_scope")
      const meta_content_scope = context.get("meta_content_scope")
      if (!meta_scope && !meta_content_scope) return
      scopes.push(meta_scope || meta_content_scope)
    })
    return scopes
  }

  getContextCount() {
    return this._contextStack.length
  }

  getBackReferences() {
    return this._backReferenceStack[this._backReferenceStack.length - 1]
  }

  pushContexts(names: string, backReferences: string[], span: Span) {
    names.split(" ").forEach(name => {
      const context = this._program.getNode("contexts " + name)
      if (!context) throw new Error(`${name} context not found`)

      this._contextStack.push(context)
      this._backReferenceStack.push(backReferences)

      if (context.has("meta_scope")) span.scopes.push(context.get("meta_scope"))
    })

    return this.currentContext
  }

  pushAnonContext(context: ContextNode, backReferences: string[], span?: Span) {
    if (context.has("meta_scope")) span.scopes.push(context.get("meta_scope"))
    this._contextStack.push(context)
    this._backReferenceStack.push(backReferences)
    return context
  }

  setContext(names: string, backReferences: string[], span: Span) {
    this.popContext()
    return this.pushContexts(names, backReferences, span)
  }

  setAnonContext(context: ContextNode, backReferences: string[], span: Span) {
    this.popContext()
    return this.pushAnonContext(context, backReferences, span)
  }

  popContext() {
    this._backReferenceStack.pop()
    const popped = this._contextStack.pop()
    this.log(`popped context ${popped.getId()}. ${this.getContextCount()} contexts on stack`)
    return popped
  }

  public getCurrentStackStr(): string {
    return this._contextStack.map(context => context.getId()).join(" ")
  }

  public get currentContext() {
    return this._contextStack[this._contextStack.length - 1]
  }
}

class Line {
  private _string: string
  constructor(line: string) {
    this._string = line
  }

  public parse(state: State): string {
    const spans: Span[] = []
    state.currentLine = this._string
    const len = this._string.length
    let current = 0
    current = state.currentContext.handle(state, spans)
    // What if currentContext does not fully handle line?

    return (
      `line ${this._string}\n` + spans.map(span => ` span ${span.text}\n  scopes ${span.scopes.join(" ")}`).join("\n")
    )
  }
}

class ProgramNode extends jtree.program {
  public hidden = false
  public first_line_match = ""
  public verbose = true

  toYAML() {
    return `%YAML 1.2
---
name: ${this.name}
file_extensions: [${this.file_extensions.join(",")}]
scope: ${this.scope}

contexts:`
  }

  public variables: { [name: string]: string } = {}

  public contexts: { [name: string]: ContextNode } = {
    prototype: new ContextNode(),
    main: new ContextNode()
  }

  public get name(): string {
    return this.get("name") || "UnnamedGrammar"
  }

  public getMainContext(): ContextNode {
    const main = this.getNode("contexts main")
    if (!main || !(main instanceof ContextNode)) throw new Error("No main context, or main ContextNode found.")
    return main
  }

  public get file_extensions(): string[] {
    return this.getNode("file_extensions").getWordsFrom(1)
  }

  public get scope(): string {
    return this.get("global_scope") || ""
  }

  toHtml(content: string): string {
    const tree = new jtree.TreeNode(content)
    const scopesToStyle = scopes => {
      return scopes
        .split(" ")
        .map(scope => {
          // cleanup
          const color = scope.includes(".") ? scope.match(/\._([^.]+)/) : [0, scope]
          if (color) return `color:${color[1]};`
          return ""
        })
        .filter(i => i)
        .join("")
    }
    return (
      "<div style='font-family: monaco; white-space: pre;'>" +
      tree
        .map(line =>
          line
            .map(
              span =>
                `<span title=" ${span.get("scopes")}" style='${scopesToStyle(span.get("scopes"))}'>${lodash.escape(
                  span.getContent()
                )}</span>`
            )
            .join("")
        )
        .join("<br>") +
      "</div>"
    )
  }

  expand() {
    this.getNode("contexts").forEach(context => {
      context.findNodes("include").forEach(inc => {
        const included = this.getNode(`contexts ${inc.getContent()}`)
        // patch?
        inc.replaceNode(str => included.childrenToString())
      })
    })
  }

  execute(content: string): string {
    this.expand()
    const state = new State(this)
    return content
      .split("\n")
      .map(line => new Line(line).parse(state))
      .join("\n")
  }
}

const Colors = {
  blue: "storage.type.string._blue",
  red: "entity.name.tag._red",
  yellow: "string.unquoted.plain.out._yellow",
  gray_italics: "comment.block.documentation._gray_italics",
  green: "entity.name.function._green",
  pink_back: "invalid.illegal.error._pink_back",
  white: "source._white",
  orange: "variable.parameter.function._orange",
  purple: "constant.numeric.yaml-version._purple"
}

// window.Colors = Colors
// window.lime = {}
// window.lime.ProgramNode = ProgramNode
// window.lime.ContextNode = ContextNode
// window.lime.MatchNode = MatchNode

export { Colors, ProgramNode, ContextNode, MatchNode }
