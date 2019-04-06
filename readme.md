# Lime

![A screenshot](/screenshot.png "Screenshot")

This package contains a rudimentary implementation of the sublime syntax highlighting engine that I made from reading the docs.

NOTE: I have not implemented everything yet and in general it's at a _very_ early stage. Just sharing this online in response to a forum comment.

Lime takes:

- takes a ".sublime-syntax" YAML file (actually, it takes a ".lime" file which is just like that except with Tree Notation syntax) for a language
- source code for that language

Lime generates:

- your source code with HTML/CSS highlighting added, which ideally would match the styles you see in Sublime text

I started this believing it might help me create better sublime-syntax files. Has this helped? The jury is still out.
