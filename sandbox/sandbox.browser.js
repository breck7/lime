const lodash = _

const main = grammarCode => {
  const grammarProgram = GrammarProgram.newFromCondensed(grammarCode, "/sandbox/")
  const LimeConstructor = grammarProgram.getRootConstructor()

  const codeArea = $("#code")
  const limeArea = $("#limeConsole")
  const either = $("#code,#limeConsole")
  const treeResults = $("#treeResults")
  const highlighted = $("#highlighted")
  const toYaml = $("#toYaml")

  const update = () => {
    const program = new LimeConstructor(limeInstance.getValue().replace(/\/\//g, "/"))

    const grammarErrors = program.getProgramErrors()

    const results = program.execute(codeArea.val())
    treeResults.html(lodash.escape(results))
    const html = program.toHtml(results)
    highlighted.html(html)
    toYaml.val(program.toYaml())
  }

  const save = () => {
    localStorage.setItem("limeConsole", limeInstance.getValue())
    localStorage.setItem("code", codeArea.val())
  }

  const grammar = localStorage.getItem("limeConsole")
  const code = localStorage.getItem("code")
  if (grammar) limeArea.val(grammar)
  if (code) codeArea.val(code)

  const limeInstance = new jtree.TreeNotationCodeMirrorMode("lime", () => LimeConstructor, undefined, CodeMirror)
    .register()
    .fromTextAreaWithAutocomplete(limeArea[0], { lineWrapping: true })

  codeArea.on("blur", save)
  codeArea.on("keyup", update)

  limeInstance.on("blur", save)
  limeInstance.on("keyup", update)

  update()
}

$(document).ready(function() {
  $.get("/lime.grammar", main)
})
