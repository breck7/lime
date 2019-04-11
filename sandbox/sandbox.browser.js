const lodash = _

const main = grammarCode => {
  const grammarProgram = GrammarProgram.newFromCondensed(grammarCode, "/sandbox/")
  const LimeConstructor = grammarProgram.getRootConstructor()

  const codeArea = $("#code")
  const grammarArea = $("#grammar")
  const either = $("#code,#grammar")
  const treeResults = $("#treeResults")
  const highlighted = $("#highlighted")
  const toYaml = $("#toYaml")

  either.on("keyup", function() {
    const code = $("#code").val()
    const program = new LimeConstructor(grammarArea.val().replace(/\/\//g, "/"))

    const grammarErrors = program.getProgramErrors()

    const results = program.execute(code)
    treeResults.html(lodash.escape(results))
    const html = program.toHtml(results)
    highlighted.html(html)
    toYaml.val(program.toYaml())
  })

  either.on("blur", function() {
    localStorage.setItem("grammar", grammarArea.val())
    localStorage.setItem("code", $("#code").val())
  })

  const grammar = localStorage.getItem("grammar")
  const code = localStorage.getItem("code")
  if (grammar) grammarArea.val(grammar)
  if (code) codeArea.val(code)

  grammarArea.keyup()
}

$(document).ready(function() {
  $.get("/lime.grammar", function(data) {
    main(data)
  })
})
