// CSP patch for the vendored libredwg worker (ТЗ 4.2.5): the emscripten
// embind/emval runtime builds invokers via `new Function`, which MV3 CSP
// (no 'unsafe-eval') blocks. Replaces both sites with closure-built
// equivalents of identical semantics. Applied by vendor-build.js after the
// worker bundle is written; fails loudly if upstream code drifts.
import { readFile, writeFile } from 'node:fs/promises';

const SITE_1 = 'return new Function(args1, invokerFnBody);';
const REPL_1 = `// CSP patch (MV3: no unsafe-eval) — closure-built invoker, same semantics
    // as the generated source this replaced.
    return function invokerFactory(_humanName, _throwBindingError, invoker, fn, runDestructors, fromRetWire, toClassParamWire, ...wire) {
      const argWire = [];
      for (let i = 0; i < argCount; ++i) argWire.push(wire[i]);
      const dtorFns = [];
      if (!needsDestructorStack) {
        for (let i = isClassMethodFunc ? 1 : 2; i < argTypes.length; ++i) {
          if (argTypes[i].destructorFunction !== null) dtorFns.push(argTypes[i].destructorFunction);
        }
      }
      return function (...rawArgs) {
        const destructors = needsDestructorStack ? [] : null;
        let thisWired;
        if (isClassMethodFunc) thisWired = toClassParamWire(destructors, this);
        const wired = new Array(argCount);
        for (let i = 0; i < argCount; ++i) wired[i] = argWire[i](destructors, rawArgs[i]);
        const call = [fn];
        if (isClassMethodFunc) call.push(thisWired);
        for (let i = 0; i < argCount; ++i) call.push(wired[i]);
        const rv = invoker.apply(null, call);
        if (needsDestructorStack) runDestructors(destructors);
        else {
          let di = 0;
          for (let i = isClassMethodFunc ? 1 : 2; i < argTypes.length; ++i) {
            if (argTypes[i].destructorFunction !== null) {
              dtorFns[di++](i === 1 ? thisWired : wired[i - 2]);
            }
          }
        }
        if (returns) return fromRetWire(rv);
      };
    };`;

const SITE_2 =
  'var invokerFunction = new Function(Object.keys(captures), functionBody)(...Object.values(captures));';
const REPL_2 = `// CSP patch (MV3: no unsafe-eval) — closure-built emval invoker.
    var invokerFunction = function (handle, methodName, destructorsRef, args) {
      const argv = argFromPtr.map((f, i) => f(args + i * GenericWireTypeSize));
      let r;
      switch (kind) {
        case 0: r = Emval.toValue(handle)(...argv); break;
        case 2: r = new (Emval.toValue(handle))(...argv); break;
        case 1: r = Emval.toValue(handle)[getStringOrSymbol(methodName)](...argv); break;
        case 3: r = argv.length ? argv[argv.length - 1] : undefined; break;
      }
      if (!retType.isVoid) return emval_returnValue(toReturnWire, destructorsRef, r);
    };`;

function replaceOnce(text, site, repl, tag) {
  const first = text.indexOf(site);
  if (first === -1) throw new Error(`vendor-patch-csp: site ${tag} not found (upstream changed?)`);
  if (text.indexOf(site, first + 1) !== -1) throw new Error(`vendor-patch-csp: site ${tag} matches more than once`);
  return text.slice(0, first) + repl + text.slice(first + site.length);
}

export async function patchCspEval(file) {
  let text = await readFile(file, 'utf8');
  text = replaceOnce(text, SITE_1, REPL_1, 'embind invoker');
  text = replaceOnce(text, SITE_2, REPL_2, 'emval invoker');
  await writeFile(file, text);
  return file;
}
