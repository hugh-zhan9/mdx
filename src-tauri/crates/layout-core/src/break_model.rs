use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BreakOpportunity {
    pub pos: usize,
    pub kind: BreakKind,
    pub penalty: Option<f32>,
    pub glue_stretch: f32,
    pub glue_shrink: f32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum BreakKind {
    CjkChar,
    LatinSpace,
    LatinHyphen,
    LatinBoundary,
    Punctuation,
    UrlOverflow,
    GlyphStretch,
}

pub fn find_break_opportunities(text: &str, font_size: f32, is_code: bool) -> Vec<BreakOpportunity> {
    let chars: Vec<char> = text.chars().collect();
    let mut breaks = Vec::new();

    for i in 0..chars.len().saturating_sub(1) {
        let current = chars[i];
        let next = chars[i + 1];
        let next_pos = i + 1;

        if is_cjk(current) {
            breaks.push(BreakOpportunity {
                pos: next_pos,
                kind: BreakKind::CjkChar,
                penalty: Some(0.0),
                glue_stretch: font_size * 0.5,
                glue_shrink: font_size * 0.25,
            });
        }

        if current.is_whitespace() && current != '\u{00A0}' {
            breaks.push(BreakOpportunity {
                pos: next_pos,
                kind: BreakKind::LatinSpace,
                penalty: Some(0.0),
                glue_stretch: font_size,
                glue_shrink: font_size * 0.5,
            });
        }

        if current == '-' && !is_code {
            breaks.push(BreakOpportunity {
                pos: next_pos,
                kind: BreakKind::LatinHyphen,
                penalty: Some(50.0),
                glue_stretch: 0.0,
                glue_shrink: 0.0,
            });
        }

        if is_cjk_punctuation(next) {
            breaks.push(BreakOpportunity {
                pos: i,
                kind: BreakKind::Punctuation,
                penalty: Some(if is_opening_punctuation(next) { 1000.0 } else { 100.0 }),
                glue_stretch: 0.0,
                glue_shrink: 0.0,
            });
        }

        if (is_cjk(current) && is_latin(next)) || (is_latin(current) && is_cjk(next)) {
            breaks.push(BreakOpportunity {
                pos: next_pos,
                kind: BreakKind::LatinBoundary,
                penalty: Some(200.0),
                glue_stretch: font_size * 0.25,
                glue_shrink: font_size * 0.1,
            });
        }
    }

    if is_code {
        for (i, ch) in chars.iter().enumerate() {
            if matches!(ch, '/' | '.' | '_' | '&' | '?') {
                breaks.push(BreakOpportunity {
                    pos: i,
                    kind: BreakKind::UrlOverflow,
                    penalty: Some(500.0),
                    glue_stretch: 0.0,
                    glue_shrink: 0.0,
                });
            }
        }
    }

    breaks
}

fn is_cjk(c: char) -> bool {
    matches!(
        c,
        '\u{3400}'..='\u{4DBF}'
            | '\u{4E00}'..='\u{9FFF}'
            | '\u{F900}'..='\u{FAFF}'
            | '\u{3000}'..='\u{303F}'
    )
}

fn is_latin(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '\'' | '’')
}

fn is_cjk_punctuation(c: char) -> bool {
    matches!(
        c,
        '、'
            | '。'
            | '，'
            | '：'
            | '；'
            | '！'
            | '？'
            | '）'
            | '】'
            | '』'
            | '」'
            | '（'
            | '【'
            | '『'
            | '「'
            | '《'
            | '》'
            | '—'
            | '…'
            | '·'
            | '“'
            | '”'
    )
}

fn is_opening_punctuation(c: char) -> bool {
    matches!(c, '（' | '【' | '『' | '「' | '《' | '“')
}
