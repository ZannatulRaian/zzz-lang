/**
 * zzz-lang interpreter
 * A browser-side interpreter for the zzz language.
 *
 * KEYWORDS
 * ──────────────────────────────────────────────
 *  zzz               program start
 *  nap               program end
 *  yawn              print
 *  //                line comment
 *  ya / nah          true / false
 *  idk               null
 *  if u care <cond>  if statement (indentation body)
 *  dont bother       else clause
 *  whatever          end if block
 *  while still awake <cond>  while loop
 *  im done           end while block
 *  im out            break
 *  name = val        variable assignment (implicit declare or update)
 *  [1,2,3]           array literal
 *  arr[i]            array index access / assignment
 *  whenever name     function definition
 *  thats it          end function
 *  do name           call function
 * ──────────────────────────────────────────────
 */

(function (global) {
  "use strict";

  // ─── XSS escape (used by index.html) ────────────────────────────────────────
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ─── Tokenizer ───────────────────────────────────────────────────────────────

  var TK = {
    // literals
    NUMBER: "NUMBER",
    STRING: "STRING",
    BOOL:   "BOOL",
    NULL:   "NULL",
    // identifiers / keywords
    IDENT:  "IDENT",
    // operators
    OP:     "OP",
    ASSIGN: "ASSIGN",       // plain =
    LBRACK: "LBRACK",       // [
    RBRACK: "RBRACK",       // ]
    LPAREN: "LPAREN",       // (
    RPAREN: "RPAREN",       // )
    COMMA:  "COMMA",        // ,
    // keywords (multi-word)
    ZZZ:    "ZZZ",          // zzz
    NAP:    "NAP",          // nap
    YAWN:   "YAWN",         // yawn
    IF:     "IF",           // if u care
    ELSE:   "ELSE",         // dont bother
    ENDIF:  "ENDIF",        // whatever
    WHILE:  "WHILE",        // while still awake
    ENDWHILE:"ENDWHILE",    // im done
    BREAK:  "BREAK",        // im out
    WHENEVER:"WHENEVER",    // whenever
    THATSIT:"THATSIT",      // thats it
    DO:     "DO",           // do
    EOF:    "EOF",
  };

  // ordered keyword patterns (longest match first)
  var KEYWORDS = [
    { pat: "while still awake", type: TK.WHILE  },
    { pat: "if u care",         type: TK.IF     },
    { pat: "dont bother",       type: TK.ELSE   },
    { pat: "im done",           type: TK.ENDWHILE },
    { pat: "thats it",          type: TK.THATSIT },
    { pat: "im out",            type: TK.BREAK  },
    { pat: "whatever",          type: TK.ENDIF  },
    { pat: "whenever",          type: TK.WHENEVER },
    { pat: "yawn",              type: TK.YAWN   },
    { pat: "zzz",               type: TK.ZZZ    },
    { pat: "nap",               type: TK.NAP    },
    { pat: "do",                type: TK.DO     },
    { pat: "ya",                type: TK.BOOL   },
    { pat: "nah",               type: TK.BOOL   },
    { pat: "idk",               type: TK.NULL   },
  ];

  function tokenize(src) {
    var tokens = [];
    var i = 0;

    while (i < src.length) {
      // skip whitespace EXCEPT newline (needed for line separation)
      if (src[i] === ' ' || src[i] === '\t' || src[i] === '\r') {
        i++;
        continue;
      }

      // newline — used as statement separator
      if (src[i] === '\n') {
        i++;
        continue;
      }

      // line comment
      if (src[i] === '/' && src[i + 1] === '/') {
        while (i < src.length && src[i] !== '\n') i++;
        continue;
      }

      // string literal (double or single quotes)
      if (src[i] === '"' || src[i] === "'") {
        var q = src[i];
        i++;
        var s = '';
        while (i < src.length && src[i] !== q) {
          if (src[i] === '\\' && i + 1 < src.length) {
            var esc2 = src[i + 1];
            if (esc2 === 'n') s += '\n';
            else if (esc2 === 't') s += '\t';
            else if (esc2 === '\\') s += '\\';
            else if (esc2 === '"') s += '"';
            else if (esc2 === "'") s += "'";
            else s += src[i + 1];
            i += 2;
          } else {
            s += src[i++];
          }
        }
        if (i >= src.length) throw new ZzzError("Unterminated string");
        i++; // closing quote
        tokens.push({ type: TK.STRING, val: s });
        continue;
      }

      // number
      if (/[0-9]/.test(src[i]) || (src[i] === '-' && /[0-9]/.test(src[i + 1] || ''))) {
        var numStr = '';
        if (src[i] === '-') numStr += src[i++];
        while (i < src.length && /[0-9]/.test(src[i])) numStr += src[i++];
        if (i < src.length && src[i] === '.') {
          numStr += src[i++];
          while (i < src.length && /[0-9]/.test(src[i])) numStr += src[i++];
        }
        tokens.push({ type: TK.NUMBER, val: parseFloat(numStr) });
        continue;
      }

      // two-char operators
      var twoChar = src.slice(i, i + 2);
      if (twoChar === '==' || twoChar === '!=' || twoChar === '>=' || twoChar === '<=' || twoChar === '&&' || twoChar === '||') {
        tokens.push({ type: TK.OP, val: twoChar });
        i += 2;
        continue;
      }

      // single-char operators
      if (src[i] === '+' || src[i] === '-' || src[i] === '*' || src[i] === '/' || src[i] === '%' || src[i] === '>' || src[i] === '<') {
        tokens.push({ type: TK.OP, val: src[i] });
        i++;
        continue;
      }
      if (src[i] === '=') {
        tokens.push({ type: TK.ASSIGN, val: '=' });
        i++;
        continue;
      }
      if (src[i] === '[') { tokens.push({ type: TK.LBRACK, val: '[' }); i++; continue; }
      if (src[i] === ']') { tokens.push({ type: TK.RBRACK, val: ']' }); i++; continue; }
      if (src[i] === '(') { tokens.push({ type: TK.LPAREN, val: '(' }); i++; continue; }
      if (src[i] === ')') { tokens.push({ type: TK.RPAREN, val: ')' }); i++; continue; }
      if (src[i] === ',') { tokens.push({ type: TK.COMMA,  val: ',' }); i++; continue; }

      // multi-word keywords and plain identifiers
      if (/[a-zA-Z_]/.test(src[i])) {
        // try multi-word keywords first (longest match)
        var matched = false;
        for (var ki = 0; ki < KEYWORDS.length; ki++) {
          var kw = KEYWORDS[ki];
          var slice = src.slice(i, i + kw.pat.length);
          // must match the pattern and then NOT be followed by a word char
          if (slice === kw.pat) {
            var after = src[i + kw.pat.length];
            // For bool/null keywords, require word boundary
            var needBoundary = (kw.type === TK.BOOL || kw.type === TK.NULL ||
                                kw.type === TK.NAP  || kw.type === TK.ZZZ  ||
                                kw.type === TK.YAWN || kw.type === TK.DO);
            if (!needBoundary || !after || !/[a-zA-Z0-9_]/.test(after)) {
              tokens.push({ type: kw.type, val: kw.pat });
              i += kw.pat.length;
              matched = true;
              break;
            }
          }
        }
        if (matched) continue;

        // plain identifier
        var id = '';
        while (i < src.length && /[a-zA-Z0-9_]/.test(src[i])) id += src[i++];
        tokens.push({ type: TK.IDENT, val: id });
        continue;
      }

      throw new ZzzError("Unexpected character: '" + src[i] + "'");
    }

    tokens.push({ type: TK.EOF, val: null });
    return tokens;
  }

  // ─── Custom error ─────────────────────────────────────────────────────────────

  function ZzzError(msg) {
    this.message = "zzz error: " + msg;
    this.name = "ZzzError";
  }
  ZzzError.prototype = Object.create(Error.prototype);

  // ─── Token stream helper ──────────────────────────────────────────────────────

  function TokenStream(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }
  TokenStream.prototype.peek = function () {
    return this.tokens[this.pos];
  };
  TokenStream.prototype.eat = function (type) {
    var tok = this.tokens[this.pos];
    if (type && tok.type !== type) {
      throw new ZzzError("Expected " + type + " but got " + tok.type + " (" + tok.val + ")");
    }
    this.pos++;
    return tok;
  };
  TokenStream.prototype.check = function (type, val) {
    var tok = this.tokens[this.pos];
    if (tok.type !== type) return false;
    if (val !== undefined && tok.val !== val) return false;
    return true;
  };
  TokenStream.prototype.eof = function () {
    return this.tokens[this.pos].type === TK.EOF;
  };

  // ─── Scope / Environment ─────────────────────────────────────────────────────

  function Scope(parent) {
    this.vars = Object.create(null);
    this.parent = parent || null;
    this.isLoop = false;
    this.doBreak = false;
    this.doReturn = false;
  }
  Scope.prototype.get = function (name) {
    if (name in this.vars) return this.vars[name];
    if (this.parent) return this.parent.get(name);
    throw new ZzzError("'" + name + "' is not defined");
  };
  Scope.prototype.set = function (name, val) {
    if (name in this.vars) {
      this.vars[name] = val;
      return;
    }
    if (this.parent && this.parent.has(name)) {
      this.parent.set(name, val);
      return;
    }
    // auto-declare at current scope (zzz is dynamic)
    this.vars[name] = val;
  };
  Scope.prototype.has = function (name) {
    if (name in this.vars) return true;
    if (this.parent) return this.parent.has(name);
    return false;
  };
  Scope.prototype.def = function (name, val) {
    this.vars[name] = val;
  };

  // ─── Parser helpers ──────────────────────────────────────────────────────────

  /*
   * parseLines: parse lines until stopFn returns true (or EOF/NAP).
   * Returns array of AST nodes.
   */
  function parseBlock(ts, stopFn) {
    var stmts = [];
    while (!ts.eof() && !ts.check(TK.NAP) && !(stopFn && stopFn(ts))) {
      var stmt = parseStatement(ts);
      if (stmt) stmts.push(stmt);
    }
    return stmts;
  }

  function parseStatement(ts) {
    var tok = ts.peek();

    // skip stray ZZZ inside program body (user might type it again)
    if (tok.type === TK.ZZZ) { ts.eat(); return null; }

    if (tok.type === TK.YAWN)    return parseYawn(ts);
    if (tok.type === TK.IF)      return parseIf(ts);
    if (tok.type === TK.WHILE)   return parseWhile(ts);
    if (tok.type === TK.BREAK)   { ts.eat(); return { type: 'break' }; }
    if (tok.type === TK.WHENEVER) return parseFuncDef(ts);
    if (tok.type === TK.DO)      return parseFuncCall(ts);
    if (tok.type === TK.IDENT)   return parseAssignOrExpr(ts);

    // anything else we skip silently (empty lines already consumed)
    ts.eat();
    return null;
  }

  // yawn <expr> [+ <expr> ...]
  function parseYawn(ts) {
    ts.eat(TK.YAWN);
    var exprs = [parseExpr(ts)];
    // allow implicit concat with +
    while (ts.check(TK.OP, '+')) {
      ts.eat(); exprs.push(parseExpr(ts));
    }
    return { type: 'yawn', exprs: exprs };
  }

  // if u care <expr> ... [dont bother ...] whatever
  function parseIf(ts) {
    ts.eat(TK.IF);
    var cond = parseExpr(ts);
    var consequent = parseBlock(ts, function (s) {
      return s.check(TK.ELSE) || s.check(TK.ENDIF);
    });
    var alternate = [];
    if (ts.check(TK.ELSE)) {
      ts.eat(TK.ELSE);
      alternate = parseBlock(ts, function (s) { return s.check(TK.ENDIF); });
    }
    if (ts.check(TK.ENDIF)) ts.eat(TK.ENDIF);
    return { type: 'if', cond: cond, consequent: consequent, alternate: alternate };
  }

  // while still awake <expr> ... im done
  function parseWhile(ts) {
    ts.eat(TK.WHILE);
    var cond = parseExpr(ts);
    var body = parseBlock(ts, function (s) { return s.check(TK.ENDWHILE); });
    if (ts.check(TK.ENDWHILE)) ts.eat(TK.ENDWHILE);
    return { type: 'while', cond: cond, body: body };
  }

  // whenever name ... thats it
  function parseFuncDef(ts) {
    ts.eat(TK.WHENEVER);
    var name = ts.eat(TK.IDENT).val;
    var body = parseBlock(ts, function (s) { return s.check(TK.THATSIT); });
    if (ts.check(TK.THATSIT)) ts.eat(TK.THATSIT);
    return { type: 'funcdef', name: name, body: body };
  }

  // do name
  function parseFuncCall(ts) {
    ts.eat(TK.DO);
    var name = ts.eat(TK.IDENT).val;
    return { type: 'call', name: name };
  }

  // assignment or expression-statement
  // handles:  x = expr   and   x[i] = expr
  function parseAssignOrExpr(ts) {
    var name = ts.eat(TK.IDENT).val;

    // array index assignment:  arr[i] = expr
    if (ts.check(TK.LBRACK)) {
      ts.eat(TK.LBRACK);
      var idx = parseExpr(ts);
      ts.eat(TK.RBRACK);
      if (ts.check(TK.ASSIGN)) {
        ts.eat(TK.ASSIGN);
        var val = parseExpr(ts);
        return { type: 'idxassign', name: name, idx: idx, val: val };
      }
      // bare array access as statement (unusual but ok)
      return { type: 'idxaccess', name: name, idx: idx };
    }

    // plain assignment:  x = expr
    if (ts.check(TK.ASSIGN)) {
      ts.eat(TK.ASSIGN);
      var rhs = parseExpr(ts);
      return { type: 'assign', name: name, val: rhs };
    }

    // bare identifier as statement (unusual but parse it)
    return { type: 'expr', expr: { type: 'ident', name: name } };
  }

  // ─── Expression parser (pratt-style, precedence climbing) ───────────────────

  var PREC = {
    '||': 1, '&&': 2,
    '==': 3, '!=': 3,
    '<': 4, '>': 4, '<=': 4, '>=': 4,
    '+': 5, '-': 5,
    '*': 6, '/': 6, '%': 6,
  };

  function parseExpr(ts, minPrec) {
    minPrec = minPrec || 0;
    var left = parsePrimary(ts);

    while (true) {
      var tok = ts.peek();
      if (tok.type !== TK.OP) break;
      var prec = PREC[tok.val];
      if (prec === undefined || prec <= minPrec) break;
      ts.eat();
      var right = parseExpr(ts, prec);
      left = { type: 'binop', op: tok.val, left: left, right: right };
    }

    return left;
  }

  function parsePrimary(ts) {
    var tok = ts.peek();

    // unary minus
    if (tok.type === TK.OP && tok.val === '-') {
      ts.eat();
      var operand = parsePrimary(ts);
      return { type: 'unary', op: '-', expr: operand };
    }

    // grouped expression
    if (tok.type === TK.LPAREN) {
      ts.eat(TK.LPAREN);
      var inner = parseExpr(ts);
      ts.eat(TK.RPAREN);
      return inner;
    }

    // literals
    if (tok.type === TK.NUMBER) {
      ts.eat();
      return { type: 'num', val: tok.val };
    }
    if (tok.type === TK.STRING) {
      ts.eat();
      return { type: 'str', val: tok.val };
    }
    if (tok.type === TK.BOOL) {
      ts.eat();
      return { type: 'bool', val: tok.val === 'ya' };
    }
    if (tok.type === TK.NULL) {
      ts.eat();
      return { type: 'null' };
    }

    // array literal
    if (tok.type === TK.LBRACK) {
      ts.eat(TK.LBRACK);
      var elems = [];
      if (!ts.check(TK.RBRACK)) {
        elems.push(parseExpr(ts));
        while (ts.check(TK.COMMA)) {
          ts.eat(TK.COMMA);
          if (ts.check(TK.RBRACK)) break; // trailing comma ok
          elems.push(parseExpr(ts));
        }
      }
      ts.eat(TK.RBRACK);
      return { type: 'array', elems: elems };
    }

    // identifier (possibly with array index)
    if (tok.type === TK.IDENT) {
      ts.eat();
      if (ts.check(TK.LBRACK)) {
        ts.eat(TK.LBRACK);
        var idxExpr = parseExpr(ts);
        ts.eat(TK.RBRACK);
        return { type: 'idxaccess', name: tok.val, idx: idxExpr };
      }
      return { type: 'ident', name: tok.val };
    }

    // ran out of tokens or hit something unexpected
    throw new ZzzError("Unexpected token in expression: " + tok.type + " (" + tok.val + ")");
  }

  // ─── Interpreter ─────────────────────────────────────────────────────────────

  function Interpreter(scope) {
    this.scope = scope;
    this.output = [];
    this.callDepth = 0;
    this.MAX_CALL_DEPTH = 200;
  }

  Interpreter.prototype.run = function (stmts) {
    for (var i = 0; i < stmts.length; i++) {
      if (this.scope.doBreak || this.scope.doReturn) break;
      this.exec(stmts[i]);
    }
  };

  Interpreter.prototype.exec = function (node) {
    if (!node) return;
    switch (node.type) {
      case 'yawn': {
        var parts = node.exprs.map(function (e) {
          return this.display(this.eval(e));
        }, this);
        this.output.push(parts.join(''));
        break;
      }
      case 'assign': {
        var v = this.eval(node.val);
        this.scope.set(node.name, v);
        break;
      }
      case 'idxassign': {
        var arr = this.scope.get(node.name);
        if (!Array.isArray(arr)) throw new ZzzError("'" + node.name + "' is not an array");
        var idx = this.eval(node.idx);
        if (typeof idx !== 'number') throw new ZzzError("Array index must be a number");
        arr[Math.floor(idx)] = this.eval(node.val);
        break;
      }
      case 'if': {
        var cond = this.eval(node.cond);
        var savedScope = this.scope;
        this.scope = new Scope(savedScope);
        this.scope.isLoop = savedScope.isLoop;
        if (cond === true || cond === 'ya') {
          this.run(node.consequent);
        } else if (node.alternate && node.alternate.length > 0) {
          this.run(node.alternate);
        }
        var br = this.scope.doBreak;
        var ret = this.scope.doReturn;
        this.scope = savedScope;
        if (br) this.scope.doBreak = true;
        if (ret) this.scope.doReturn = true;
        break;
      }
      case 'while': {
        var MAX = 50000;
        var iterations = 0;
        var outerScope = this.scope;
        this.scope = new Scope(outerScope);
        this.scope.isLoop = true;
        while (true) {
          if (++iterations > MAX) throw new ZzzError("Infinite loop detected (>50000 iterations)");
          var whileCond = this.eval(node.cond);
          if (whileCond !== true && whileCond !== 'ya') break;
          this.scope.doBreak = false;
          this.run(node.body);
          if (this.scope.doBreak) break;
          if (this.scope.doReturn) break;
        }
        var doRet2 = this.scope.doReturn;
        this.scope = outerScope;
        if (doRet2) this.scope.doReturn = true;
        break;
      }
      case 'break': {
        if (!this.scope.isLoop) throw new ZzzError("'im out' used outside a loop");
        this.scope.doBreak = true;
        break;
      }
      case 'funcdef': {
        var funcName = node.name;
        var funcBody = node.body;
        var capturedScope = this.scope;
        this.scope.def(funcName, { __zzzfunc__: true, body: funcBody, closure: capturedScope });
        break;
      }
      case 'call': {
        var fn = this.scope.get(node.name);
        if (!fn || !fn.__zzzfunc__) throw new ZzzError("'" + node.name + "' is not a function");
        if (++this.callDepth > this.MAX_CALL_DEPTH) {
          this.callDepth = 0;
          throw new ZzzError("Stack overflow (too many nested 'do' calls)");
        }
        var fnScope = new Scope(fn.closure);
        fnScope.isLoop = false;
        var prevScope = this.scope;
        this.scope = fnScope;
        this.run(fn.body);
        this.scope = prevScope;
        this.callDepth--;
        break;
      }
      case 'expr':
        this.eval(node.expr);
        break;
      case 'idxaccess':
        this.eval(node);
        break;
      default:
        // no-op for unknown nodes
        break;
    }
  };

  Interpreter.prototype.eval = function (node) {
    switch (node.type) {
      case 'num':    return node.val;
      case 'str':    return node.val;
      case 'bool':   return node.val;
      case 'null':   return null;
      case 'ident':  return this.scope.get(node.name);
      case 'unary': {
        var v = this.eval(node.expr);
        if (node.op === '-') {
          if (typeof v !== 'number') throw new ZzzError("Cannot negate non-number");
          return -v;
        }
        throw new ZzzError("Unknown unary op: " + node.op);
      }
      case 'array': {
        return node.elems.map(function (e) { return this.eval(e); }, this);
      }
      case 'idxaccess': {
        var arr2 = this.scope.get(node.name);
        if (!Array.isArray(arr2)) throw new ZzzError("'" + node.name + "' is not an array");
        var idx2 = this.eval(node.idx);
        if (typeof idx2 !== 'number') throw new ZzzError("Array index must be a number");
        var result = arr2[Math.floor(idx2)];
        return result === undefined ? null : result;
      }
      case 'binop': {
        var op = node.op;
        // short-circuit logical
        if (op === '&&') {
          var l = this.eval(node.left);
          return this.isTruthy(l) ? this.eval(node.right) : l;
        }
        if (op === '||') {
          var ll = this.eval(node.left);
          return this.isTruthy(ll) ? ll : this.eval(node.right);
        }
        var left = this.eval(node.left);
        var right = this.eval(node.right);
        return this.applyOp(op, left, right);
      }
      default:
        throw new ZzzError("Cannot evaluate node type: " + node.type);
    }
  };

  Interpreter.prototype.isTruthy = function (v) {
    if (v === null || v === false || v === 0 || v === '') return false;
    return true;
  };

  Interpreter.prototype.applyOp = function (op, a, b) {
    switch (op) {
      case '+':
        if (typeof a === 'number' && typeof b === 'number') return a + b;
        if (a === null || b === null) throw new ZzzError("Cannot use '+' with null (idk)");
        return String(a) + String(b);
      case '-':
        if (typeof a === 'number' && typeof b === 'number') return a - b;
        throw new ZzzError("'-' requires two numbers");
      case '*':
        if (typeof a === 'number' && typeof b === 'number') return a * b;
        throw new ZzzError("'*' requires two numbers");
      case '/':
        if (typeof a === 'number' && typeof b === 'number') {
          if (b === 0) throw new ZzzError("Division by zero");
          return a / b;
        }
        throw new ZzzError("'/' requires two numbers");
      case '%':
        if (typeof a === 'number' && typeof b === 'number') return a % b;
        throw new ZzzError("'%' requires two numbers");
      case '==': return a === b;
      case '!=': return a !== b;
      case '<':
        if (typeof a === 'number' && typeof b === 'number') return a < b;
        throw new ZzzError("'<' requires two numbers");
      case '>':
        if (typeof a === 'number' && typeof b === 'number') return a > b;
        throw new ZzzError("'>' requires two numbers");
      case '<=':
        if (typeof a === 'number' && typeof b === 'number') return a <= b;
        throw new ZzzError("'<=' requires two numbers");
      case '>=':
        if (typeof a === 'number' && typeof b === 'number') return a >= b;
        throw new ZzzError("'>=' requires two numbers");
      default:
        throw new ZzzError("Unknown operator: " + op);
    }
  };

  // Format a value for display (yawn)
  Interpreter.prototype.display = function (v) {
    if (v === null)           return 'idk';
    if (v === true)           return 'ya';
    if (v === false)          return 'nah';
    if (Array.isArray(v))     return '[' + v.map(this.display, this).join(', ') + ']';
    if (typeof v === 'object' && v.__zzzfunc__) return '<function>';
    return String(v);
  };

  // ─── Main entry point ─────────────────────────────────────────────────────────

  /**
   * interpret(src) → string[]
   *
   * Parses and runs zzz source code.
   * Returns an array of output lines.
   * Throws ZzzError (with .message) on runtime/syntax errors.
   */
  function interpret(src) {
    src = String(src).trim();

    // Must start with zzz
    if (!src.startsWith('zzz')) {
      throw new ZzzError("Every program must start with 'zzz'");
    }

    // Must end with nap (may have trailing whitespace)
    if (!/\bnap\s*$/.test(src)) {
      throw new ZzzError("Every program must end with 'nap'");
    }

    // Tokenize
    var tokens;
    try {
      tokens = tokenize(src);
    } catch (e) {
      if (e instanceof ZzzError) throw e;
      throw new ZzzError(e.message || String(e));
    }

    var ts = new TokenStream(tokens);

    // Consume leading 'zzz'
    ts.eat(TK.ZZZ);

    // Parse body up to 'nap'
    var stmts;
    try {
      stmts = parseBlock(ts, function (s) { return s.check(TK.NAP); });
    } catch (e) {
      if (e instanceof ZzzError) throw e;
      throw new ZzzError(e.message || String(e));
    }

    // Consume 'nap'
    if (ts.check(TK.NAP)) ts.eat(TK.NAP);

    // Execute
    var globalScope = new Scope(null);
    var interp = new Interpreter(globalScope);
    try {
      interp.run(stmts);
    } catch (e) {
      if (e instanceof ZzzError) throw e;
      throw new ZzzError(e.message || String(e));
    }

    return interp.output;
  }

  // ─── Exports ──────────────────────────────────────────────────────────────────
  global.interpret = interpret;
  global.esc = esc;

})(typeof window !== 'undefined' ? window : global);
