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
        // When a context has multiple patterns, the leftmost one will be found.
        // When multiple patterns match at the same position, the first defined pattern will be selected.
        this.match = /a/g;
        this.captures = {};
    }
    getScopes() {
        return this.has("scope") ? this.get("scope").split(" ") : [];
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
    test(line, state, consumed) {
        let match;
        let matches = [];
        let reg = this.getReg(state);
        let re = new RegExp(reg, "g");
        // Only should break for lookbehinds?
        line = line.substr(consumed);
        // This will start things at consumed, but allow for lookbehinds.
        //re.lastIndex = consumed
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
                start: match.index + consumed,
                end: text.length + match.index + consumed,
                text: text,
                captured: captured,
                matchNode: this
            };
            matches.push(result);
        }
        if (matches.length)
            state.log(`'${line}' matched '${reg}'`, matches);
        else
            state.log(`'${line}' no match on '${reg}'`);
        return matches;
    }
}
exports.MatchNode = MatchNode;
class Include {
}
class ContextNode extends jtree.NonTerminalNode {
    constructor() {
        super(...arguments);
        this.backReferences = [];
    }
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
    handle(state, spans, consumed = 0) {
        const line = state.currentLine;
        state.log(`'${this.getKeyword()}' handling '${line}'`);
        const allMatchResults = this.getChildrenByNodeType(MatchNode).map(node => node.test(line, state, consumed));
        // Sort by left most.
        const sorted = lodash.sortBy(lodash.flatten(allMatchResults), ["start"]);
        const len = line.length;
        state.log(`${sorted.length} matches for '${line}'`);
        while (consumed <= len && sorted.length) {
            const nextMatch = sorted.shift();
            const scopes = state.getScopeChain();
            state.log(`match '${nextMatch.text}' starts on position ${nextMatch.start} and consumed is ${consumed}`);
            if (nextMatch.start < consumed) {
                state.log(`for match '${nextMatch.text}' and reg '${nextMatch.matchNode.getReg(state)}', nextMatch.start is ${nextMatch.start} and consumed is ${consumed}, continuing loop.`);
                state.log("for some reason start is less than consumed. why? note this in code.");
                continue;
            }
            // add skipped matches:
            if (nextMatch.start > consumed) {
                spans.push({
                    text: line.substr(consumed, nextMatch.start - consumed),
                    scopes: scopes
                });
                state.log(`Added missing span between ${consumed} and ${nextMatch.start}`);
            }
            // Apply match
            const matchNode = nextMatch.matchNode;
            const newScopes = scopes.concat(matchNode.getScopes());
            spans.push({
                text: nextMatch.text,
                scopes: newScopes
            });
            state.currentContext.backReferences = nextMatch.captured;
            state.log(`Added span for '${nextMatch.text}' with scopes '${newScopes}'`);
            const matchObj = matchNode.toObject();
            if (matchObj.push) {
                state.log("push context " + matchObj.push);
                const context = state.pushContexts(matchObj.push);
                consumed = context.handle(state, spans, nextMatch.end);
            }
            else if (matchObj.push_context) {
                state.log("push anon context");
                const context = state.pushAnonContext(matchNode.getNode("push_context"));
                consumed = context.handle(state, spans, nextMatch.end);
            }
            else if (matchNode.get("pop") === "true") {
                state.log(`pop context '${state.currentContext.getId()}'. Return ${nextMatch.end}`);
                state.contextStack.pop();
                //state.currentContext.backReferences = [] Clear back refs ever?
                // jump consumed
                return state.currentContext.handle(state, spans, nextMatch.end);
            }
            else if (matchObj.set) {
                state.log(`set context so pop '${state.currentContext.getId()}' and push 'matchObj.push'`);
                state.contextStack.pop();
                const context = state.pushContexts(matchObj.push);
                // TODO: how do back refs work with set?
                context.backReferences = nextMatch.captured;
                return context.handle(state, spans, nextMatch.end);
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
        state.log("handled line.");
        return consumed;
    }
}
exports.ContextNode = ContextNode;
class State {
    constructor(program) {
        this.contextStack = [];
        this._program = program;
        this.contextStack.push(program.getMainContext());
    }
    log(...obj) {
        if (this._program.verbose)
            console.log(this.currentLine + ": ", ...obj);
    }
    logError(...obj) {
        if (this._program.verbose)
            console.error(this.currentLine + ": ", ...obj);
    }
    getContextChain() {
        return this.contextStack.map(context => context.getId()).join(" ");
    }
    getScopeChain() {
        const arr = this.contextStack.map(context => context.get("meta_scope")).filter(i => i);
        arr.unshift(this._program.scope);
        return arr;
    }
    getBackReferences() {
        if (this.contextStack.length === 1)
            return [];
        return this.contextStack[this.contextStack.length - 2].backReferences;
    }
    pushAnonContext(context) {
        this.contextStack.push(context);
        return context;
    }
    pushContexts(names) {
        names.split(" ").forEach(name => {
            const context = this._program.getNode("contexts " + name);
            if (!context)
                throw new Error(`${name} context not found`);
            this.contextStack.push(context);
        });
        return this.currentContext;
    }
    get currentContext() {
        return this.contextStack[this.contextStack.length - 1];
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
        return this.get("global_scope") || "brown";
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
