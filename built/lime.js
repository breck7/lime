"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const lodash = require("lodash");
// import * as jtree from "jtree"
const jtree = require("jtree");
//const dates: Date[] = [1, new Date()].filter(num => num instanceof Date)
class MetaScope {
}
class EmbedStatement {
    constructor() {
        this.escape_captures = {}; // Use capture group 0 to apply a scope to the entire escape match.
    }
}
/*
Note on RegExpExecArray:
https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/exec
If the match succeeds, the exec() method returns an array and updates properties of the
regular expression object. The returned array has the matched text as the first item, and
then one item for each capturing parenthesis that matched containing the text that was captured.
*/
class MatchNode extends jtree.NonTerminalNode {
    constructor() {
        super(...arguments);
        this.captures = {};
    }
    getScopes(state) {
        const scopes = state.getScopeChain();
        // If its a pop, dont include meta_content_scope of parent context.
        if (this.get("pop") === "true" && state.currentContext.has("meta_content_scope"))
            scopes.pop();
        const newScopes = this.has("scope") ? this.get("scope").split(" ") : [];
        return scopes.concat(newScopes);
    }
    getReg(state) {
        let reg = this.getContent();
        const backReferences = state.getBackReferences();
        if (backReferences.length === 0 && reg.match(/\\\d/))
            state.logError(`Expected a backreference(s) in '${reg}' but none passed. Current context '${state.currentContext.getId()}'. Parent contexts: '${state.getContextChain()}' .`, backReferences);
        // replace back references
        for (let index = 0; index < backReferences.length; index++) {
            let re2 = new RegExp(`\\\\${index + 1}`, "g");
            reg = reg.replace(re2, backReferences[index]);
        }
        return reg;
    }
    testLine(line, state, consumed) {
        let match;
        let matches = [];
        let reg = this.getReg(state);
        let re = new RegExp(reg, "g");
        // Only should break for lookbehinds?
        //line = line.substr(consumed)
        // This will start things at consumed, but allow for lookbehinds.
        re.lastIndex = consumed;
        const backRefs = state.getBackReferences();
        let startChar = -1;
        while ((match = re.exec(line)) !== null) {
            // protect against infinite loops, ie if regex is ^
            if (match.index > startChar)
                startChar = match.index;
            else
                break;
            const text = match[0];
            const captured = [];
            let index = 1;
            while (match[index] !== undefined) {
                captured.push(match[index]);
                state.log(`Saving backreference '${match[index]}' from reg '${reg}' in line '${line}'`);
                index++;
            }
            const result = {
                start: match.index,
                end: text.length + match.index,
                text: text,
                captured: captured,
                matchNode: this,
                usedRegString: reg,
                usedBackReferences: backRefs,
                usedLine: line
            };
            matches.push(result);
        }
        // if (matches.length) state.log(`'${line}' matched '${reg}'`, matches)
        // else state.log(`'${line}' no match on '${reg}'`)
        return matches;
    }
}
exports.MatchNode = MatchNode;
class Include {
}
class ContextNode extends jtree.NonTerminalNode {
    isMain() {
        return this.getId() === "main";
    }
    getId() {
        return this.getKeyword();
    }
    getExpanded() {
        // todo: add includes and prototypes
        return this.items;
    }
    _testLineAgainstAllMatchesAndGetSortedResults(state, consumed) {
        const allMatchResults = this.getChildrenByNodeType(MatchNode).map(node => node.testLine(state.currentLine, state, consumed));
        // Sort by left most.
        return lodash.sortBy(lodash.flatten(allMatchResults), ["start"]);
    }
    handle(state, spans, consumed = 0) {
        const line = state.currentLine;
        state.log(`context '${this.getKeyword()}' handling '${line}'. Part: '${line.substr(consumed)}'`);
        // Sort by left most.
        const sortedMatches = this._testLineAgainstAllMatchesAndGetSortedResults(state, consumed);
        const len = line.length;
        state.log(`${sortedMatches.length} matches for '${line}'`);
        while (consumed <= len && sortedMatches.length) {
            const nextMatch = sortedMatches.shift();
            // state.log(`match '${nextMatch.text}' starts on position ${nextMatch.start} and consumed is ${consumed}`)
            if (nextMatch.start < consumed) {
                state.log(`for match '${nextMatch.text}' and reg '${nextMatch.matchNode.getReg(state)}', nextMatch.start is ${nextMatch.start} and consumed is ${consumed}, continuing loop.`);
                state.log("for some reason start is less than consumed. why? note this in code.");
                continue;
            }
            // add skipped matches:
            if (nextMatch.start > consumed) {
                spans.push({
                    text: line.substr(consumed, nextMatch.start - consumed),
                    scopes: state.getScopeChain()
                });
                state.log(`Added missing span between ${consumed} and ${nextMatch.start}`);
            }
            // Apply match
            const matchNode = nextMatch.matchNode;
            const newSpan = {
                text: nextMatch.text,
                scopes: matchNode.getScopes(state)
            };
            spans.push(newSpan);
            const matchObj = matchNode.toObject();
            state.log(`Added new span for '${nextMatch.text}' with scopes '${newSpan.scopes.join(" ")}'`, nextMatch);
            if (matchObj.push) {
                // todo: if there is a metascope, we need to add that scope above.
                consumed = state.pushContexts(matchObj.push, nextMatch.captured, newSpan).handle(state, spans, nextMatch.end);
            }
            else if (matchObj.push_context) {
                consumed = state
                    .pushAnonContext(matchNode.getNode("push_context"), nextMatch.captured, newSpan)
                    .handle(state, spans, nextMatch.end);
            }
            else if (matchObj.set) {
                return state.setContext(matchObj.set, nextMatch.captured, newSpan).handle(state, spans, nextMatch.end);
            }
            else if (matchObj.set_context) {
                return state
                    .setAnonContext(matchNode.getNode("set_context"), nextMatch.captured, newSpan)
                    .handle(state, spans, nextMatch.end);
            }
            else if (matchNode.get("pop") === "true") {
                state.popContext();
                return state.currentContext.handle(state, spans, nextMatch.end);
            }
            else {
                consumed = nextMatch.end;
            }
        }
        // Not sure about this. What about run ons?
        if (consumed < len - 1) {
            state.log("Consumed ${consumed} is less than ${len - 1}. Adding scope.");
            spans.push({
                text: line.substr(consumed),
                scopes: state.getScopeChain()
            });
            consumed = len; // Minus 1 or 1?
        }
        //state.log(`handled line. '${line}'`)
        return consumed;
    }
}
exports.ContextNode = ContextNode;
class State {
    constructor(program) {
        this._messageNumber = 0;
        this._contextStack = [];
        this._backReferenceStack = [];
        this._program = program;
        this.pushAnonContext(program.getMainContext(), []);
    }
    log(...obj) {
        if (this._program.verbose) {
            this._messageNumber++;
            console.log(`${this._messageNumber}. line: '${this.currentLine}'. context: '${this.getCurrentStackStr()}' `, ...obj);
        }
    }
    logError(...obj) {
        if (this._program.verbose)
            console.error(this.currentLine + ": ", ...obj);
    }
    getContextChain() {
        return this._contextStack.map(context => context.getId()).join(" ");
    }
    getScopeChain() {
        const scopes = [this._program.scope];
        this._contextStack.forEach(context => {
            const meta_scope = context.get("meta_scope");
            const meta_content_scope = context.get("meta_content_scope");
            if (!meta_scope && !meta_content_scope)
                return;
            scopes.push(meta_scope || meta_content_scope);
        });
        return scopes;
    }
    getContextCount() {
        return this._contextStack.length;
    }
    getBackReferences() {
        return this._backReferenceStack[this._backReferenceStack.length - 1];
    }
    pushContexts(names, backReferences, span) {
        names.split(" ").forEach(name => {
            const context = this._program.getNode("contexts " + name);
            if (!context)
                throw new Error(`${name} context not found`);
            this._contextStack.push(context);
            this._backReferenceStack.push(backReferences);
            if (context.has("meta_scope"))
                span.scopes.push(context.get("meta_scope"));
        });
        return this.currentContext;
    }
    pushAnonContext(context, backReferences, span) {
        if (context.has("meta_scope"))
            span.scopes.push(context.get("meta_scope"));
        this._contextStack.push(context);
        this._backReferenceStack.push(backReferences);
        return context;
    }
    setContext(names, backReferences, span) {
        this.popContext();
        return this.pushContexts(names, backReferences, span);
    }
    setAnonContext(context, backReferences, span) {
        this.popContext();
        return this.pushAnonContext(context, backReferences, span);
    }
    popContext() {
        this._backReferenceStack.pop();
        const popped = this._contextStack.pop();
        this.log(`popped context ${popped.getId()}. ${this.getContextCount()} contexts on stack`);
        return popped;
    }
    getCurrentStackStr() {
        return this._contextStack.map(context => context.getId()).join(" ");
    }
    get currentContext() {
        return this._contextStack[this._contextStack.length - 1];
    }
}
class Line {
    constructor(line) {
        this._string = line;
    }
    parse(state) {
        const spans = [];
        state.currentLine = this._string;
        const len = this._string.length;
        let current = 0;
        current = state.currentContext.handle(state, spans);
        // What if currentContext does not fully handle line?
        return (`line ${this._string}\n` + spans.map(span => ` span ${span.text}\n  scopes ${span.scopes.join(" ")}`).join("\n"));
    }
}
class ProgramNode extends jtree.program {
    constructor() {
        super(...arguments);
        this.hidden = false;
        this.first_line_match = "";
        this.verbose = true;
        this.variables = {};
        this.contexts = {
            prototype: new ContextNode(),
            main: new ContextNode()
        };
    }
    toYAML() {
        return `%YAML 1.2
---
name: ${this.name}
file_extensions: [${this.file_extensions.join(",")}]
scope: ${this.scope}

contexts:`;
    }
    get name() {
        return this.get("name") || "UnnamedGrammar";
    }
    getMainContext() {
        const main = this.getNode("contexts main");
        if (!main || !(main instanceof ContextNode))
            throw new Error("No main context, or main ContextNode found.");
        return main;
    }
    get file_extensions() {
        return this.getNode("file_extensions").getWordsFrom(1);
    }
    get scope() {
        return this.get("global_scope") || "";
    }
    toHtml(content) {
        const tree = new jtree.TreeNode(content);
        const scopesToStyle = scopes => {
            return scopes
                .split(" ")
                .map(scope => {
                // cleanup
                const color = scope.includes(".") ? scope.match(/\._([^.]+)/) : [0, scope];
                if (color)
                    return `color:${color[1]};`;
                return "";
            })
                .filter(i => i)
                .join("");
        };
        return ("<div style='font-family: monaco; white-space: pre;'>" +
            tree
                .map(line => line
                .map(span => `<span title=" ${span.get("scopes")}" style='${scopesToStyle(span.get("scopes"))}'>${lodash.escape(span.getContent())}</span>`)
                .join(""))
                .join("<br>") +
            "</div>");
    }
    expand() {
        this.getNode("contexts").forEach(context => {
            context.findNodes("include").forEach(inc => {
                const included = this.getNode(`contexts ${inc.getContent()}`);
                // patch?
                inc.replaceNode(str => included.childrenToString());
            });
        });
    }
    execute(content) {
        this.expand();
        const state = new State(this);
        return content
            .split("\n")
            .map(line => new Line(line).parse(state))
            .join("\n");
    }
}
exports.ProgramNode = ProgramNode;
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
};
exports.Colors = Colors;
