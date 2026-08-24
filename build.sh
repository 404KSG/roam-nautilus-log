#!/usr/bin/env bash
set -euo pipefail

if command -v clojure >/dev/null 2>&1; then
  clojure -Sdeps '{:deps {}}' -M -e '
    (import (java.io FileReader))
    (import (clojure.lang LineNumberingPushbackReader))
    (with-open [reader (LineNumberingPushbackReader. (FileReader. "src/component.cljs"))]
      (let [eof (Object.)]
        (loop [forms 0]
          (let [form (read {:eof eof :read-cond :allow :features #{:cljs}} reader)]
            (if (identical? form eof)
              (println "Validated" forms "Clojure forms in src/component.cljs")
              (recur (inc forms)))))))'
fi

npm ci
npm run build
