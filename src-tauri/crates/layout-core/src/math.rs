//! Math layout engine.
//!
//! Parses LaTeX math strings into an AST and lays them out as positioned
//! [`CanvasDrawOp`] elements for Canvas/SVG rendering.
//!
//! # Design
//!
//! 1. **Tokenizer** – converts the raw LaTeX string into a token stream.
//! 2. **Parser** – recursive-descent parser building a [`MathExpr`] AST.
//! 3. **Layout** – walks the AST and produces positioned [`CanvasDrawOp`] values.
//!
//! Errors produce a dedicated "error" draw op rather than panicking.

use crate::{CanvasDrawKind, CanvasDrawOp, MathDisplay};
use serde::Serialize;

// ─── Constants ──────────────────────────────────────────────────────────────

/// Advance (width) per character relative to font size.
const CHAR_ADVANCE_RATIO: f32 = 0.6;
/// Fraction of font size above the baseline.
const ASCENDER_RATIO: f32 = 0.7;
/// Fraction of font size below the baseline.
const DESCENDER_RATIO: f32 = 0.3;
/// Font size multiplier for script (superscript / subscript) text.
const SCRIPT_SIZE_RATIO: f32 = 0.7;
/// How far (in parent font-size units) a superscript baseline is raised.
const SCRIPT_RAISE: f32 = 0.5;
/// How far (in parent font-size units) a subscript baseline is lowered.
const SCRIPT_LOWER: f32 = 0.2;
/// Gap between superscript/subscript and the base (in parent font-size units).
const SCRIPT_GAP: f32 = 0.05;
/// Thickness of the fraction rule relative to font size.
const FRAC_LINE_THICKNESS_RATIO: f32 = 0.06;
/// Gap between fraction line and numerator/denominator (relative to current font size).
const FRAC_GAP_RATIO: f32 = 0.15;
/// Extra padding around a radicand relative to its font size.
const RADICAL_PADDING: f32 = 0.1;
/// Width of the radical sign relative to its height.
const RADICAL_WIDTH_RATIO: f32 = 0.6;
/// Extra height the radical sign extends above the radicand.
const RADICAL_EXTRA_RATIO: f32 = 0.1;
/// Font size multiplier for BigOp in display (block) mode.
const BIGOP_DISPLAY_RATIO: f32 = 1.3;
/// Limit font size relative to operator font size.
const LIMIT_SIZE_RATIO: f32 = 0.7;
/// Gap between operator and limits.
const LIMIT_GAP_RATIO: f32 = 0.15;

// ─── Tokenizer ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Char(char),
    Command(String),
    Superscript, // ^
    Subscript,   // _
    LBrace,      // {
    RBrace,      // }
    LBracket,    // [
    RBracket,    // ]
}

struct Tokenizer {
    chars: Vec<char>,
    pos: usize,
}

impl Tokenizer {
    fn new(input: &str) -> Self {
        Self {
            chars: input.chars().collect(),
            pos: 0,
        }
    }

    fn next(&mut self) -> Option<Token> {
        self.skip_whitespace();
        let c = self.chars.get(self.pos).copied()?;
        match c {
            '\\' => {
                self.pos += 1;
                let mut name = String::new();
                while let Some(&ch) = self.chars.get(self.pos) {
                    if ch.is_ascii_alphabetic() {
                        name.push(ch);
                        self.pos += 1;
                    } else {
                        break;
                    }
                }
                // Backslash followed by a single non-alpha (e.g. \, for thin space)
                if name.is_empty() {
                    name.push(self.chars.get(self.pos).copied().unwrap_or(' '));
                    self.pos += 1;
                }
                Some(Token::Command(name))
            }
            '^' => {
                self.pos += 1;
                Some(Token::Superscript)
            }
            '_' => {
                self.pos += 1;
                Some(Token::Subscript)
            }
            '{' => {
                self.pos += 1;
                Some(Token::LBrace)
            }
            '}' => {
                self.pos += 1;
                Some(Token::RBrace)
            }
            '[' => {
                self.pos += 1;
                Some(Token::LBracket)
            }
            ']' => {
                self.pos += 1;
                Some(Token::RBracket)
            }
            _ => {
                self.pos += 1;
                Some(Token::Char(c))
            }
        }
    }

    fn skip_whitespace(&mut self) {
        while let Some(&c) = self.chars.get(self.pos) {
            if c.is_ascii_whitespace() {
                self.pos += 1;
            } else {
                break;
            }
        }
    }
}

// ─── AST ────────────────────────────────────────────────────────────────────

/// A parsed LaTeX math expression.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub enum MathExpr {
    /// Run of ordinary text characters (e.g. "abc").
    Text(String),
    /// A named command like `\alpha`, `\sum`.
    Command(String),
    /// A group `{ ... }`.
    Group(Vec<MathExpr>),
    /// Base with optional superscript and subscript.
    Scripts(Box<MathExpr>, Option<Box<MathExpr>>, Option<Box<MathExpr>>),
    /// `\frac{numerator}{denominator}`
    Fraction(Box<MathExpr>, Box<MathExpr>),
    /// `\sqrt[degree]{radicand}`
    Sqrt(Box<MathExpr>, Option<Box<MathExpr>>),
    /// `\sum_{lower}^{upper}` etc.
    BigOp(String, Option<Box<MathExpr>>, Option<Box<MathExpr>>),
    /// `\left delimiter ... \right delimiter`
    Delimited(char, Vec<MathExpr>, char),
    /// Placeholder for a parse error – never panics.
    Error(String),
}

// ─── Parser ─────────────────────────────────────────────────────────────────

struct Parser {
    tokens: Vec<Token>,
    pos: usize,
}

impl Parser {
    fn new(input: &str) -> Self {
        let mut tok = Tokenizer::new(input);
        let mut tokens = Vec::new();
        while let Some(t) = tok.next() {
            tokens.push(t);
        }
        Self { tokens, pos: 0 }
    }

    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.pos)
    }

    fn advance(&mut self) {
        self.pos += 1;
    }

    fn expect_end(&self) -> bool {
        self.pos >= self.tokens.len()
    }

    fn parse_math(&mut self) -> MathExpr {
        let mut terms = Vec::new();
        while !self.expect_end() {
            let term = self.parse_term();
            terms.push(term);
        }
        if terms.len() == 1 {
            terms.swap_remove(0)
        } else {
            MathExpr::Group(terms)
        }
    }

    /// Parse a term: base optional-^optional-_.
    /// `a^2` → Scripts(a, Some(2), None)
    /// `a_1` → Scripts(a, None, Some(1))
    /// `a^2_1` / `a_1^2` → Scripts(a, Some(2), Some(1))
    fn parse_term(&mut self) -> MathExpr {
        let base = self.parse_base();

        let has_sup = self.peek() == Some(&Token::Superscript);
        let has_sub = self.peek() == Some(&Token::Subscript);

        if !has_sup && !has_sub {
            return base;
        }

        let mut sup = None;
        let mut sub = None;

        // Consume first script token
        let first = self.peek().cloned();
        self.advance();
        let first_expr = self.parse_script_body();
        match first {
            Some(Token::Superscript) => sup = Some(first_expr),
            Some(Token::Subscript) => sub = Some(first_expr),
            _ => {}
        }

        // Check for second script token
        if self.peek() == Some(&Token::Superscript) || self.peek() == Some(&Token::Subscript) {
            let second = self.peek().cloned();
            self.advance();
            let second_expr = self.parse_script_body();
            match second {
                Some(Token::Superscript) => sup = Some(second_expr),
                Some(Token::Subscript) => sub = Some(second_expr),
                _ => {}
            }
        }

        MathExpr::Scripts(Box::new(base), sup.map(Box::new), sub.map(Box::new))
    }

    /// Parse the body of a script (^ or _): either a single token or a { ... } group.
    fn parse_script_body(&mut self) -> MathExpr {
        match self.peek() {
            Some(Token::LBrace) => {
                self.advance();
                let mut terms = Vec::new();
                let mut closed = false;
                loop {
                    match self.peek() {
                        None | Some(Token::RBrace) => break,
                        _ => terms.push(self.parse_term()),
                    }
                }
                if self.peek() == Some(&Token::RBrace) {
                    self.advance();
                    closed = true;
                }
                if !closed {
                    return MathExpr::Error("missing closing brace".into());
                }
                if terms.len() == 1 {
                    terms.swap_remove(0)
                } else {
                    MathExpr::Group(terms)
                }
            }
            Some(_) => {
                let expr = self.parse_base();
                expr
            }
            None => MathExpr::Error("unexpected end of input after script".into()),
        }
    }

    /// Parse an atomic expression: char, command, \frac, \sqrt, \left, or { ... }.
    fn parse_base(&mut self) -> MathExpr {
        match self.peek() {
            None => MathExpr::Error("unexpected end of input".into()),
            Some(Token::Char(c)) => {
                let c = *c;
                self.advance();
                MathExpr::Text(c.to_string())
            }
            Some(Token::Command(cmd)) => {
                let cmd = cmd.clone();
                self.advance();
                match cmd.as_str() {
                    "frac" => {
                        let num = self.parse_group_or_error("fraction numerator");
                        let den = self.parse_group_or_error("fraction denominator");
                        if let MathExpr::Error(message) = &num {
                            MathExpr::Error(message.clone())
                        } else if let MathExpr::Error(message) = &den {
                            MathExpr::Error(message.clone())
                        } else {
                            MathExpr::Fraction(Box::new(num), Box::new(den))
                        }
                    }
                    "sqrt" => {
                        // Optional [degree]
                        let degree = if self.peek() == Some(&Token::LBracket) {
                            self.advance();
                            let mut terms = Vec::new();
                            loop {
                                match self.peek() {
                                    None | Some(Token::RBracket) => break,
                                    _ => terms.push(self.parse_term()),
                                }
                            }
                            if self.peek() == Some(&Token::RBracket) {
                                self.advance();
                            }
                            let deg = if terms.len() == 1 {
                                terms.swap_remove(0)
                            } else {
                                MathExpr::Group(terms)
                            };
                            Some(Box::new(deg))
                        } else {
                            None
                        };
                        let radicand = self.parse_group_or_error("sqrt radicand");
                        if let MathExpr::Error(message) = &radicand {
                            MathExpr::Error(message.clone())
                        } else {
                            MathExpr::Sqrt(Box::new(radicand), degree)
                        }
                    }
                    "left" => {
                        let left_delim = self.parse_delimiter();
                        let mut content = Vec::new();
                        loop {
                            match self.peek() {
                                None => {
                                    content.push(MathExpr::Error("missing \\right".into()));
                                    break;
                                }
                                Some(Token::Command(c)) if c == "right" => {
                                    self.advance();
                                    let right_delim = self.parse_delimiter();
                                    return MathExpr::Delimited(left_delim, content, right_delim);
                                }
                                _ => content.push(self.parse_term()),
                            }
                        }
                        MathExpr::Group(content)
                    }
                    "sum" | "prod" | "int" => {
                        // Optional limits: _{lower}^{upper} or ^{upper}_{lower}
                        let mut lower = None;
                        let mut upper = None;
                        if self.peek() == Some(&Token::Subscript) {
                            self.advance();
                            lower = Some(Box::new(self.parse_script_body()));
                        }
                        if self.peek() == Some(&Token::Superscript) {
                            self.advance();
                            upper = Some(Box::new(self.parse_script_body()));
                        }
                        MathExpr::BigOp(cmd, lower, upper)
                    }
                    _ => MathExpr::Command(cmd),
                }
            }
            Some(Token::LBrace) => {
                self.advance();
                let mut terms = Vec::new();
                loop {
                    match self.peek() {
                        None | Some(Token::RBrace) => break,
                        _ => terms.push(self.parse_term()),
                    }
                }
                if self.peek() == Some(&Token::RBrace) {
                    self.advance();
                }
                if terms.len() == 1 {
                    terms.swap_remove(0)
                } else {
                    MathExpr::Group(terms)
                }
            }
            Some(other) => {
                // Handle ^ or _ without a prior base (e.g. at start of input)
                let other = other.clone();
                match other {
                    Token::Superscript | Token::Subscript => {
                        let tok = self.peek().cloned();
                        self.advance();
                        let body = self.parse_script_body();
                        match tok {
                            Some(Token::Superscript) => MathExpr::Scripts(
                                Box::new(MathExpr::Text(String::new())),
                                Some(Box::new(body)),
                                None,
                            ),
                            Some(Token::Subscript) => MathExpr::Scripts(
                                Box::new(MathExpr::Text(String::new())),
                                None,
                                Some(Box::new(body)),
                            ),
                            _ => MathExpr::Error("unexpected token".into()),
                        }
                    }
                    _ => {
                        self.advance();
                        MathExpr::Error(format!("unexpected token {:?}", other))
                    }
                }
            }
        }
    }

    /// Parse a group `{ ... }` or produce an error placeholder.
    fn parse_group_or_error(&mut self, context: &str) -> MathExpr {
        match self.peek() {
            Some(Token::LBrace) => self.parse_base(),
            Some(_) => self.parse_base(),
            None => MathExpr::Error(format!("expected group for {}", context)),
        }
    }

    /// Parse a delimiter character (after \left or \right).
    fn parse_delimiter(&mut self) -> char {
        match self.peek() {
            Some(Token::Char(c)) => {
                let c = *c;
                self.advance();
                c
            }
            Some(Token::Command(c)) => {
                let c = c.clone();
                self.advance();
                // Map common delimiter commands
                match c.as_str() {
                    "lbrace" => '{',
                    "rbrace" => '}',
                    "langle" => '\u{27e8}',
                    "rangle" => '\u{27e9}',
                    "vert" => '|',
                    "." => '.', // \left. or \right. means no delimiter
                    _ => '?',
                }
            }
            None => '?',
            _ => '?',
        }
    }
}

/// Parse a LaTeX math string into a [`MathExpr`] AST.
///
/// The parser never panics — syntax errors produce [`MathExpr::Error`] nodes.
pub fn parse_math(input: &str) -> MathExpr {
    let mut parser = Parser::new(input);
    parser.parse_math()
}

// ─── Context ────────────────────────────────────────────────────────────────

/// Layout context for math rendering.
#[derive(Debug, Clone)]
pub struct MathContext {
    /// Base font size in pixels.
    pub font_size: f32,
    /// Whether this is inline or block (display) math.
    pub display_mode: MathDisplay,
}

impl MathContext {
    pub fn new(font_size: f32, display_mode: MathDisplay) -> Self {
        Self {
            font_size,
            display_mode,
        }
    }
}

/// Glyph-level metadata produced during layout.
#[derive(Debug, Clone, Serialize)]
pub struct MathGlyphInfo {
    pub glyph: String,
    pub x: f32,
    pub y: f32,
    pub font_size: f32,
}

// ─── Layout ─────────────────────────────────────────────────────────────────

/// Internal result from laying out a single [`MathExpr`] node.
///
/// All `ops` are positioned with (0, 0) at the baseline-left corner of this node.
struct LayoutResult {
    ops: Vec<CanvasDrawOp>,
    width: f32,
    /// Total height above the baseline.
    height: f32,
    /// Total depth below the baseline.
    depth: f32,
}

impl LayoutResult {
    fn total_height(&self) -> f32 {
        self.height + self.depth
    }
}

fn char_advance(font_size: f32) -> f32 {
    font_size * CHAR_ADVANCE_RATIO
}

fn char_height(font_size: f32) -> f32 {
    font_size * ASCENDER_RATIO
}

fn char_depth(font_size: f32) -> f32 {
    font_size * DESCENDER_RATIO
}

fn text_width(text: &str, font_size: f32) -> f32 {
    text.chars().count() as f32 * char_advance(font_size)
}

/// Map a command name to its Unicode glyph (if available).
fn command_glyph(name: &str) -> Option<&'static str> {
    match name {
        "alpha" => Some("\u{03b1}"),
        "beta" => Some("\u{03b2}"),
        "gamma" => Some("\u{03b3}"),
        "delta" => Some("\u{03b4}"),
        "epsilon" => Some("\u{03b5}"),
        "zeta" => Some("\u{03b6}"),
        "eta" => Some("\u{03b7}"),
        "theta" => Some("\u{03b8}"),
        "iota" => Some("\u{03b9}"),
        "kappa" => Some("\u{03ba}"),
        "lambda" => Some("\u{03bb}"),
        "mu" => Some("\u{03bc}"),
        "nu" => Some("\u{03bd}"),
        "xi" => Some("\u{03be}"),
        "omicron" => Some("\u{03bf}"),
        "pi" => Some("\u{03c0}"),
        "rho" => Some("\u{03c1}"),
        "sigma" => Some("\u{03c3}"),
        "tau" => Some("\u{03c4}"),
        "upsilon" => Some("\u{03c5}"),
        "phi" => Some("\u{03c6}"),
        "chi" => Some("\u{03c7}"),
        "psi" => Some("\u{03c8}"),
        "omega" => Some("\u{03c9}"),

        "Alpha" => Some("\u{0391}"),
        "Beta" => Some("\u{0392}"),
        "Gamma" => Some("\u{0393}"),
        "Delta" => Some("\u{0394}"),
        "Epsilon" => Some("\u{0395}"),
        "Zeta" => Some("\u{0396}"),
        "Eta" => Some("\u{0397}"),
        "Theta" => Some("\u{0398}"),
        "Iota" => Some("\u{0399}"),
        "Kappa" => Some("\u{039a}"),
        "Lambda" => Some("\u{039b}"),
        "Mu" => Some("\u{039c}"),
        "Nu" => Some("\u{039d}"),
        "Xi" => Some("\u{039e}"),
        "Omicron" => Some("\u{039f}"),
        "Pi" => Some("\u{03a0}"),
        "Rho" => Some("\u{03a1}"),
        "Sigma" => Some("\u{03a3}"),
        "Tau" => Some("\u{03a4}"),
        "Upsilon" => Some("\u{03a5}"),
        "Phi" => Some("\u{03a6}"),
        "Chi" => Some("\u{03a7}"),
        "Psi" => Some("\u{03a8}"),
        "Omega" => Some("\u{03a9}"),

        "infty" => Some("\u{221e}"),
        "times" => Some("\u{00d7}"),
        "div" => Some("\u{00f7}"),
        "pm" => Some("\u{00b1}"),
        "mp" => Some("\u{2213}"),
        "neq" => Some("\u{2260}"),
        "leq" => Some("\u{2264}"),
        "geq" => Some("\u{2265}"),
        "approx" => Some("\u{2248}"),
        "equiv" => Some("\u{2261}"),
        "subset" => Some("\u{2282}"),
        "supset" => Some("\u{2283}"),
        "subseteq" => Some("\u{2286}"),
        "supseteq" => Some("\u{2287}"),
        "cup" => Some("\u{222a}"),
        "cap" => Some("\u{222b}"),
        "in" => Some("\u{2208}"),
        "notin" => Some("\u{2209}"),
        "forall" => Some("\u{2200}"),
        "exists" => Some("\u{2203}"),
        "nabla" => Some("\u{2207}"),
        "partial" => Some("\u{2202}"),
        "hbar" => Some("\u{210f}"),
        "ell" => Some("\u{2113}"),
        "Re" => Some("\u{211c}"),
        "Im" => Some("\u{2111}"),
        "to" => Some("\u{2192}"),
        "rightarrow" => Some("\u{2192}"),
        "leftarrow" => Some("\u{2190}"),
        "mapsto" => Some("\u{21a6}"),
        "cdot" => Some("\u{00b7}"),
        "cdots" => Some("\u{22ef}"),
        "dots" => Some("\u{2026}"),
        "emptyset" => Some("\u{2205}"),

        _ => None,
    }
}

/// Map a command name to its BigOp display name.
fn bigop_display_name(name: &str) -> &str {
    match name {
        "sum" => "\u{2211}",  // Σ
        "prod" => "\u{220f}", // Π
        "int" => "\u{222b}",  // ∫
        _ => name,
    }
}

/// Build a CanvasDrawOp for the given block_id with Math kind.
fn make_op(block_id: &str, x: f32, y: f32, w: f32, h: f32, data: impl Serialize) -> CanvasDrawOp {
    CanvasDrawOp {
        block_id: block_id.to_string(),
        kind: CanvasDrawKind::Math,
        x,
        y,
        width: w,
        height: h,
        data: serde_json::to_string(&data)
            .unwrap_or_else(|_| r#"{"type":"error","msg":"serialization failed"}"#.into()),
    }
}

// ─── JSON data payloads ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
enum MathOpData {
    #[serde(rename = "text")]
    Text { content: String },
    #[serde(rename = "frac_line")]
    FracLine,
    #[serde(rename = "radical")]
    Radical,
    #[serde(rename = "bigop")]
    BigOp { name: String },
    #[serde(rename = "error")]
    Error { msg: String },
}

// ─── Layout implementation ──────────────────────────────────────────────────

/// Lay out a [`MathExpr`] AST node and produce positioned ops.
///
/// `block_id` is shared across all output ops. All positions are relative to
/// the baseline-left origin (0, 0) of this node.
fn layout_expr(expr: &MathExpr, fs: f32, block_id: &str) -> LayoutResult {
    match expr {
        MathExpr::Text(content) => layout_text(content, fs, block_id),
        MathExpr::Command(name) => layout_command(name, fs, block_id),
        MathExpr::Group(children) => layout_group(children, fs, block_id),
        MathExpr::Scripts(base, sup, sub) => {
            layout_scripts(base, sup.as_deref(), sub.as_deref(), fs, block_id)
        }
        MathExpr::Fraction(num, den) => layout_fraction(num, den, fs, block_id),
        MathExpr::Sqrt(radicand, degree) => layout_sqrt(radicand, degree.as_deref(), fs, block_id),
        MathExpr::BigOp(name, lower, upper) => {
            layout_bigop(name, lower.as_deref(), upper.as_deref(), fs, block_id)
        }
        MathExpr::Delimited(left, content, right) => {
            layout_delimited(*left, content, *right, fs, block_id)
        }
        MathExpr::Error(msg) => {
            let h = char_height(fs);
            let d = char_depth(fs);
            LayoutResult {
                ops: vec![make_op(
                    block_id,
                    0.0,
                    0.0,
                    text_width(msg, fs),
                    h + d,
                    MathOpData::Error { msg: msg.clone() },
                )],
                width: text_width(msg, fs),
                height: h,
                depth: d,
            }
        }
    }
}

fn layout_text(content: &str, fs: f32, block_id: &str) -> LayoutResult {
    let w = text_width(content, fs);
    let h = char_height(fs);
    let d = char_depth(fs);
    LayoutResult {
        ops: vec![make_op(
            block_id,
            0.0,
            -h,
            w,
            h + d,
            MathOpData::Text {
                content: content.to_string(),
            },
        )],
        width: w,
        height: h,
        depth: d,
    }
}

fn layout_command(name: &str, fs: f32, block_id: &str) -> LayoutResult {
    // Try to map to a glyph, otherwise use the command name as text
    let glyph = command_glyph(name).unwrap_or(name);
    let w = text_width(glyph, fs);
    let h = char_height(fs);
    let d = char_depth(fs);
    LayoutResult {
        ops: vec![make_op(
            block_id,
            0.0,
            -h,
            w,
            h + d,
            MathOpData::Text {
                content: glyph.to_string(),
            },
        )],
        width: w,
        height: h,
        depth: d,
    }
}

fn layout_group(children: &[MathExpr], fs: f32, block_id: &str) -> LayoutResult {
    if children.is_empty() {
        return LayoutResult {
            ops: vec![],
            width: 0.0,
            height: 0.0,
            depth: 0.0,
        };
    }

    let mut all_ops = Vec::new();
    let mut cursor_x = 0.0_f32;
    let mut total_height = 0.0_f32;
    let mut total_depth = 0.0_f32;

    for child in children {
        let result = layout_expr(child, fs, block_id);
        // Shift ops by cursor_x
        for op in &result.ops {
            all_ops.push(CanvasDrawOp {
                x: op.x + cursor_x,
                ..op.clone()
            });
        }
        total_height = total_height.max(result.height);
        total_depth = total_depth.max(result.depth);
        cursor_x += result.width;
    }

    LayoutResult {
        ops: all_ops,
        width: cursor_x,
        height: total_height,
        depth: total_depth,
    }
}

fn layout_scripts(
    base: &MathExpr,
    sup: Option<&MathExpr>,
    sub: Option<&MathExpr>,
    fs: f32,
    block_id: &str,
) -> LayoutResult {
    let base_result = layout_expr(base, fs, block_id);
    let script_fs = fs * SCRIPT_SIZE_RATIO;
    let gap = fs * SCRIPT_GAP;

    let mut all_ops = base_result.ops.clone();
    let mut width = base_result.width;
    let mut height = base_result.height;
    let mut depth = base_result.depth;

    if let Some(sup_expr) = sup {
        let sup_result = layout_expr(sup_expr, script_fs, block_id);
        let sup_baseline = -(fs * SCRIPT_RAISE);
        let sup_h = char_height(script_fs);
        let sup_d = char_depth(script_fs);

        for op in &sup_result.ops {
            all_ops.push(CanvasDrawOp {
                x: op.x + width + gap,
                y: op.y + sup_baseline,
                ..op.clone()
            });
        }
        let sup_top = sup_baseline - sup_h;
        let sup_bottom = sup_baseline + sup_d;

        if -sup_top > height {
            height = -sup_top;
        }
        if sup_bottom > depth {
            depth = sup_bottom;
        }
        width += gap + sup_result.width;
    }

    if let Some(sub_expr) = sub {
        let sub_result = layout_expr(sub_expr, script_fs, block_id);
        let sub_baseline = fs * SCRIPT_LOWER;
        let sub_d = char_depth(script_fs);

        for op in &sub_result.ops {
            all_ops.push(CanvasDrawOp {
                x: op.x + width + gap,
                y: op.y + sub_baseline,
                ..op.clone()
            });
        }
        let sub_bottom = sub_baseline + sub_d;

        if sub_bottom > depth {
            depth = sub_bottom;
        }
        width += gap + sub_result.width;
    }

    LayoutResult {
        ops: all_ops,
        width,
        height,
        depth,
    }
}

fn layout_fraction(num: &MathExpr, den: &MathExpr, fs: f32, block_id: &str) -> LayoutResult {
    let inner_fs = fs * SCRIPT_SIZE_RATIO;
    let num_result = layout_expr(num, inner_fs, block_id);
    let den_result = layout_expr(den, inner_fs, block_id);

    let frac_width = num_result.width.max(den_result.width) + fs * 0.2;
    let line_thickness = fs * FRAC_LINE_THICKNESS_RATIO;
    let gap = fs * FRAC_GAP_RATIO;

    // Fraction line is at y=0 (baseline)
    let num_baseline = -(gap + line_thickness / 2.0 + num_result.depth);
    let den_baseline = gap + line_thickness / 2.0 + den_result.height;

    let mut all_ops = Vec::new();

    // Fraction line
    let line_y = -line_thickness / 2.0;
    all_ops.push(make_op(
        block_id,
        0.0,
        line_y,
        frac_width,
        line_thickness,
        MathOpData::FracLine,
    ));

    // Numerator (centered above)
    let num_x = (frac_width - num_result.width) / 2.0;
    for op in &num_result.ops {
        all_ops.push(CanvasDrawOp {
            x: op.x + num_x,
            y: op.y + num_baseline,
            ..op.clone()
        });
    }

    // Denominator (centered below)
    let den_x = (frac_width - den_result.width) / 2.0;
    for op in &den_result.ops {
        all_ops.push(CanvasDrawOp {
            x: op.x + den_x,
            y: op.y + den_baseline,
            ..op.clone()
        });
    }

    let total_height = -num_baseline + num_result.height;
    let total_depth = den_baseline + den_result.depth;

    LayoutResult {
        ops: all_ops,
        width: frac_width,
        height: total_height,
        depth: total_depth,
    }
}

fn layout_sqrt(
    radicand: &MathExpr,
    degree: Option<&MathExpr>,
    fs: f32,
    block_id: &str,
) -> LayoutResult {
    let rad_result = layout_expr(radicand, fs, block_id);
    let padding = fs * RADICAL_PADDING;

    let rad_total = rad_result.total_height();
    let radical_extra = fs * RADICAL_EXTRA_RATIO;
    let radical_height = rad_total + radical_extra * 2.0;
    let radical_width = radical_height * RADICAL_WIDTH_RATIO;

    let total_width = radical_width + padding + rad_result.width;
    let total_height = rad_result.height + radical_extra;
    let total_depth = rad_result.depth + radical_extra;

    let mut all_ops = Vec::new();

    // Radical sign
    all_ops.push(make_op(
        block_id,
        0.0,
        -(rad_result.height + radical_extra),
        radical_width,
        radical_height,
        MathOpData::Radical,
    ));

    // Radicand (to the right of radical sign)
    let rad_x = radical_width + padding;
    for op in &rad_result.ops {
        all_ops.push(CanvasDrawOp {
            x: op.x + rad_x,
            y: op.y,
            ..op.clone()
        });
    }

    // Degree (if present, placed above the radical tick)
    if let Some(deg) = degree {
        let deg_fs = fs * SCRIPT_SIZE_RATIO;
        let deg_result = layout_expr(deg, deg_fs, block_id);
        let deg_x = -deg_result.width * 0.3;
        let deg_y = -(rad_result.height + radical_extra) - deg_result.depth - fs * 0.05;
        for op in &deg_result.ops {
            all_ops.push(CanvasDrawOp {
                x: op.x + deg_x,
                y: op.y + deg_y,
                ..op.clone()
            });
        }
    }

    LayoutResult {
        ops: all_ops,
        width: total_width,
        height: total_height,
        depth: total_depth,
    }
}

fn layout_bigop(
    name: &str,
    lower: Option<&MathExpr>,
    upper: Option<&MathExpr>,
    fs: f32,
    block_id: &str,
) -> LayoutResult {
    let op_fs = fs * BIGOP_DISPLAY_RATIO;
    let glyph = bigop_display_name(name);
    let op_w = text_width(glyph, op_fs);
    let op_h = char_height(op_fs);
    let op_d = char_depth(op_fs);

    let mut all_ops = Vec::new();
    let mut width = op_w;
    let mut height = op_h;
    let mut depth = op_d;

    // Operator
    all_ops.push(make_op(
        block_id,
        0.0,
        -op_h,
        op_w,
        op_h + op_d,
        MathOpData::BigOp {
            name: name.to_string(),
        },
    ));

    let limit_fs = fs * LIMIT_SIZE_RATIO;
    let limit_gap = fs * LIMIT_GAP_RATIO;

    // Lower limit (below operator)
    if let Some(low) = lower {
        let low_result = layout_expr(low, limit_fs, block_id);
        let low_baseline = op_d + limit_gap + low_result.height;

        let low_x = (op_w - low_result.width) / 2.0;
        for op in &low_result.ops {
            all_ops.push(CanvasDrawOp {
                x: op.x + low_x,
                y: op.y + low_baseline,
                ..op.clone()
            });
        }

        let low_bottom = low_baseline + low_result.depth;
        if low_bottom > depth {
            depth = low_bottom;
        }
        width = width.max(low_result.width);
    }

    // Upper limit (above operator)
    if let Some(up) = upper {
        let up_result = layout_expr(up, limit_fs, block_id);
        let up_baseline = -(op_h + limit_gap + up_result.depth);

        let up_x = (op_w - up_result.width) / 2.0;
        for op in &up_result.ops {
            all_ops.push(CanvasDrawOp {
                x: op.x + up_x,
                y: op.y + up_baseline,
                ..op.clone()
            });
        }

        let up_top = up_baseline - up_result.height;
        if -up_top > height {
            height = -up_top;
        }
        width = width.max(up_result.width);
    }

    LayoutResult {
        ops: all_ops,
        width,
        height,
        depth,
    }
}

fn layout_delimited(
    _left: char,
    content: &[MathExpr],
    _right: char,
    fs: f32,
    block_id: &str,
) -> LayoutResult {
    let content_result = layout_group(content, fs, block_id);

    // Add small padding for delimiters
    let delim_pad = fs * 0.15;
    let mut all_ops = Vec::new();

    // Shift content ops to the right by delimiter padding
    for op in &content_result.ops {
        all_ops.push(CanvasDrawOp {
            x: op.x + delim_pad,
            ..op.clone()
        });
    }

    LayoutResult {
        ops: all_ops,
        width: content_result.width + delim_pad * 2.0,
        height: content_result.height,
        depth: content_result.depth,
    }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/// Parse a LaTeX math string and lay out the result.
///
/// Returns a flat `Vec` of positioned [`CanvasDrawOp`] values, one per
/// renderable element (text glyph, fraction line, radical sign, etc.).
///
/// Errors in parsing produce an `Error` draw op instead of panicking.
pub fn layout_math(block_id: &str, input: &str, ctx: &MathContext) -> Vec<CanvasDrawOp> {
    let expr = parse_math(input);
    layout_math_expr(block_id, &expr, ctx)
}

/// Lay out a pre-parsed [`MathExpr`].
pub fn layout_math_expr(block_id: &str, expr: &MathExpr, ctx: &MathContext) -> Vec<CanvasDrawOp> {
    let result = layout_expr(expr, ctx.font_size, block_id);

    // Normalize positions so y=0 is at the top (canvas convention)
    let top_y = -result.height;
    result
        .ops
        .into_iter()
        .map(|op| CanvasDrawOp {
            y: op.y - top_y,
            ..op
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_char() {
        let expr = parse_math("x");
        assert_eq!(expr, MathExpr::Text("x".to_string()));
    }

    #[test]
    fn test_parse_command() {
        let expr = parse_math("\\alpha");
        assert!(matches!(expr, MathExpr::Command(ref n) if n == "alpha"));
    }

    #[test]
    fn test_parse_superscript() {
        let expr = parse_math("x^2");
        assert!(matches!(expr, MathExpr::Scripts(..)));
        if let MathExpr::Scripts(base, sup, sub) = &expr {
            assert_eq!(**base, MathExpr::Text("x".to_string()));
            assert_eq!(**sup.as_ref().unwrap(), MathExpr::Text("2".to_string()));
            assert!(sub.is_none());
        }
    }

    #[test]
    fn test_parse_subscript() {
        let expr = parse_math("a_1");
        assert!(matches!(expr, MathExpr::Scripts(..)));
        if let MathExpr::Scripts(base, sup, sub) = &expr {
            assert_eq!(**base, MathExpr::Text("a".to_string()));
            assert!(sup.is_none());
            assert_eq!(**sub.as_ref().unwrap(), MathExpr::Text("1".to_string()));
        }
    }

    #[test]
    fn test_parse_both_scripts() {
        let expr = parse_math("x_i^2");
        assert!(matches!(expr, MathExpr::Scripts(..)));
        if let MathExpr::Scripts(base, sup, sub) = &expr {
            assert_eq!(**base, MathExpr::Text("x".to_string()));
            assert!(sup.is_some());
            assert!(sub.is_some());
        }
    }

    #[test]
    fn test_parse_fraction() {
        let expr = parse_math("\\frac{a}{b}");
        assert!(matches!(expr, MathExpr::Fraction(..)));
    }

    #[test]
    fn test_parse_sqrt() {
        let expr = parse_math("\\sqrt{x}");
        assert!(matches!(expr, MathExpr::Sqrt(..)));
    }

    #[test]
    fn test_parse_sum_with_limits() {
        let expr = parse_math("\\sum_{i=0}^{n}");
        assert!(matches!(expr, MathExpr::BigOp(..)));
    }

    #[test]
    fn test_parse_group() {
        let expr = parse_math("{abc}");
        assert!(matches!(expr, MathExpr::Group(ref children) if children.len() == 3));
    }

    #[test]
    fn test_parse_error_unclosed_brace() {
        // Should not panic
        let expr = parse_math("\\frac{a");
        assert!(matches!(expr, MathExpr::Error(_)));
    }
}
