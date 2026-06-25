use std::cmp::Ordering;

use crate::break_model::find_break_opportunities;
use crate::font_api::FontMetricsProvider;
use crate::{InlineKind, InlineRun, InlineStyle, LayoutLine, StyleContext, TextRunPosition};

#[derive(Debug, Clone)]
pub struct ParagraphInput<'a> {
    pub block_id: String,
    pub inlines: &'a [InlineRun],
    pub line_width: f32,
    pub font_size: f32,
    pub line_height: f32,
    pub is_code: bool,
    pub style_context: &'a StyleContext,
}

impl<'a> ParagraphInput<'a> {
    pub fn new(
        block_id: String,
        inlines: &'a [InlineRun],
        line_width: f32,
        font_size: f32,
        line_height: f32,
        is_code: bool,
        style_context: &'a StyleContext,
    ) -> Self {
        Self {
            block_id,
            inlines,
            line_width,
            font_size,
            line_height,
            is_code,
            style_context,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParagraphLayoutMode {
    Auto,
    KnuthPlass,
    Greedy,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParagraphLayoutError {
    NoBreakCandidates,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum TokenKind {
    Text,
    Whitespace,
}

#[derive(Debug, Clone)]
enum ParagraphPiece {
    Text(Vec<Token>),
    HardBreak(usize),
}

#[derive(Debug, Clone)]
struct Token {
    kind: TokenKind,
    text: String,
    pm_from: usize,
    pm_to: usize,
    width: f32,
    break_after: bool,
    source_run_index: usize,
    font_family: String,
    style: StyleSignature,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct StyleSignature {
    bold: bool,
    italic: bool,
    code: bool,
    link: Option<String>,
    strike: bool,
    underline: bool,
}

impl From<&InlineStyle> for StyleSignature {
    fn from(style: &InlineStyle) -> Self {
        Self {
            bold: style.bold,
            italic: style.italic,
            code: style.code,
            link: style.link.clone(),
            strike: style.strike,
            underline: style.underline,
        }
    }
}

pub fn layout_paragraph(
    input: &ParagraphInput<'_>,
    font_metrics: &dyn FontMetricsProvider,
) -> Vec<LayoutLine> {
    layout_paragraph_with_mode(input, font_metrics, ParagraphLayoutMode::Auto)
}

pub fn layout_paragraph_with_mode(
    input: &ParagraphInput<'_>,
    font_metrics: &dyn FontMetricsProvider,
    mode: ParagraphLayoutMode,
) -> Vec<LayoutLine> {
    match mode {
        ParagraphLayoutMode::Greedy => layout_paragraph_greedy(input, font_metrics),
        ParagraphLayoutMode::KnuthPlass => layout_paragraph_knuth_plass(input, font_metrics)
            .unwrap_or_else(|_| layout_paragraph_greedy(input, font_metrics)),
        ParagraphLayoutMode::Auto => layout_paragraph_knuth_plass(input, font_metrics)
            .unwrap_or_else(|_| layout_paragraph_greedy(input, font_metrics)),
    }
}

pub fn layout_paragraph_knuth_plass(
    input: &ParagraphInput<'_>,
    font_metrics: &dyn FontMetricsProvider,
) -> Result<Vec<LayoutLine>, ParagraphLayoutError> {
    Ok(layout_paragraph_greedy(input, font_metrics))
}

/// Compatibility surface that currently delegates to greedy line breaking.
pub fn layout_paragraph_greedy(
    input: &ParagraphInput<'_>,
    font_metrics: &dyn FontMetricsProvider,
) -> Vec<LayoutLine> {
    let line_height_px = input.font_size * input.line_height;
    let pieces = tokenize_paragraph(input, font_metrics);
    let mut lines = Vec::new();
    let mut line_index = 0usize;

    for (idx, piece) in pieces.iter().enumerate() {
        match piece {
            ParagraphPiece::Text(tokens) => {
                layout_text_piece_greedy(
                    input,
                    tokens,
                    &mut lines,
                    &mut line_index,
                    line_height_px,
                );
            }
            ParagraphPiece::HardBreak(count) => {
                let has_text_before = pieces[..idx]
                    .iter()
                    .any(|piece| matches!(piece, ParagraphPiece::Text(_)));
                let has_text_after = pieces[idx + 1..]
                    .iter()
                    .any(|piece| matches!(piece, ParagraphPiece::Text(_)));
                let blank_lines = if has_text_before && has_text_after {
                    count.saturating_sub(1)
                } else {
                    *count
                };

                for _ in 0..blank_lines {
                    lines.push(build_empty_line(
                        &input.block_id,
                        line_index,
                        input.font_size,
                        line_height_px,
                    ));
                    line_index += 1;
                }
            }
        }
    }

    lines
}

fn tokenize_paragraph(
    input: &ParagraphInput<'_>,
    font_metrics: &dyn FontMetricsProvider,
) -> Vec<ParagraphPiece> {
    let mut paragraphs = Vec::new();
    let mut current = Vec::new();
    let mut pending_breaks = 0usize;

    for (run_index, run) in input.inlines.iter().enumerate() {
        if matches!(run.kind, InlineKind::HardBreak) {
            if !current.is_empty() {
                paragraphs.push(ParagraphPiece::Text(std::mem::take(&mut current)));
            }
            pending_breaks += 1;
            continue;
        }

        if pending_breaks > 0 {
            paragraphs.push(ParagraphPiece::HardBreak(pending_breaks));
            pending_breaks = 0;
        }

        current.extend(tokenize_run(run_index, run, input, font_metrics));
    }

    if !current.is_empty() {
        paragraphs.push(ParagraphPiece::Text(current));
    }
    if pending_breaks > 0 {
        paragraphs.push(ParagraphPiece::HardBreak(pending_breaks));
    }

    paragraphs
}

fn layout_text_piece_greedy(
    input: &ParagraphInput<'_>,
    tokens: &[Token],
    lines: &mut Vec<LayoutLine>,
    line_index: &mut usize,
    line_height_px: f32,
) {
    let mut start = 0usize;
    let mut idx = 0usize;
    let mut last_break = None;

    while idx < tokens.len() {
        if tokens[idx].break_after {
            last_break = Some(idx + 1);
        }

        let width = measure_range_width(tokens, start, idx + 1);
        if width > input.line_width {
            let end = last_break
                .filter(|candidate| *candidate > start)
                .unwrap_or(idx);

            if end == start {
                if let Some(line) = build_line(
                    &input.block_id,
                    tokens,
                    start,
                    idx + 1,
                    *line_index,
                    input.font_size,
                    line_height_px,
                ) {
                    lines.push(line);
                    *line_index += 1;
                }
                start = idx + 1;
                idx = start;
                last_break = None;
                continue;
            }

            if let Some(line) = build_line(
                &input.block_id,
                tokens,
                start,
                end,
                *line_index,
                input.font_size,
                line_height_px,
            ) {
                lines.push(line);
                *line_index += 1;
            }
            start = end;
            idx = start;
            last_break = None;
            continue;
        }

        idx += 1;
    }

    if start < tokens.len() {
        if let Some(line) = build_line(
            &input.block_id,
            tokens,
            start,
            tokens.len(),
            *line_index,
            input.font_size,
            line_height_px,
        ) {
            lines.push(line);
            *line_index += 1;
        }
    }
}

fn tokenize_run(
    run_index: usize,
    run: &InlineRun,
    input: &ParagraphInput<'_>,
    font_metrics: &dyn FontMetricsProvider,
) -> Vec<Token> {
    if run.to <= run.from {
        return Vec::new();
    }

    let span_limit = (run.to - run.from).min(run.text.len());
    let span_limit = if run.text.is_char_boundary(span_limit) {
        span_limit
    } else {
        let mut boundary = span_limit;
        while boundary > 0 && !run.text.is_char_boundary(boundary) {
            boundary -= 1;
        }
        boundary
    };

    if span_limit == 0 {
        return Vec::new();
    }

    let text = &run.text[..span_limit];
    if text.is_empty() {
        return Vec::new();
    }
    let breaks = find_break_opportunities(text, input.font_size, input.is_code || run.style.code);
    let break_positions: std::collections::HashSet<usize> =
        breaks.into_iter().map(|op| op.pos).collect();
    let mut tokens = Vec::new();
    let mut cursor = 0usize;

    while cursor < text.len() {
        let ch = text[cursor..]
            .chars()
            .next()
            .expect("cursor must remain on a char boundary");

        if ch.is_whitespace() {
            let start = cursor;
            cursor += ch.len_utf8();
            while cursor < text.len() {
                let next = text[cursor..]
                    .chars()
                    .next()
                    .expect("cursor must remain on a char boundary");
                if !next.is_whitespace() {
                    break;
                }
                cursor += next.len_utf8();
            }

            let segment = &text[start..cursor];
            tokens.push(Token {
                kind: TokenKind::Whitespace,
                text: segment.to_string(),
                pm_from: run.from + start,
                pm_to: run.from + cursor,
                width: font_metrics.text_width(segment, input.font_size),
                break_after: true,
                source_run_index: run_index,
                font_family: input.style_context.default_font_family.clone(),
                style: StyleSignature::from(&run.style),
            });
            continue;
        }

        let start = cursor;
        cursor += ch.len_utf8();
        while cursor < text.len() {
            if break_positions.contains(&cursor) {
                break;
            }
            let next = text[cursor..]
                .chars()
                .next()
                .expect("cursor must remain on a char boundary");
            if next.is_whitespace() {
                break;
            }
            cursor += next.len_utf8();
        }

        let segment = &text[start..cursor];
        tokens.push(Token {
            kind: TokenKind::Text,
            text: segment.to_string(),
            pm_from: run.from + start,
            pm_to: run.from + cursor,
            width: font_metrics.text_width(segment, input.font_size),
            break_after: break_positions.contains(&cursor),
            source_run_index: run_index,
            font_family: input.style_context.default_font_family.clone(),
            style: StyleSignature::from(&run.style),
        });
    }

    tokens
}

fn build_line(
    block_id: &str,
    tokens: &[Token],
    start: usize,
    end: usize,
    line_index: usize,
    font_size: f32,
    line_height_px: f32,
) -> Option<LayoutLine> {
    if start >= end {
        return None;
    }
    let baseline = font_size;
    let mut text_runs: Vec<TextRunPosition> = Vec::new();
    let mut merged_runs: Vec<MergedRun> = Vec::new();
    let mut left = 0.0f32;

    let Some((trimmed_start, trimmed_end)) = trim_range(tokens, start, end) else {
        return None;
    };

    for (relative_idx, token) in tokens[start..end].iter().enumerate() {
        let is_boundary_whitespace = token.kind == TokenKind::Whitespace
            && (start + relative_idx == trimmed_start || start + relative_idx + 1 == trimmed_end);
        let visual_width = if is_boundary_whitespace {
            0.0
        } else {
            token.width
        };

        if let (Some(previous_run), Some(previous_meta)) =
            (text_runs.last_mut(), merged_runs.last_mut())
        {
            if previous_meta.pm_to == token.pm_from
                && previous_run.font_family == token.font_family
                && previous_meta.source_run_index == token.source_run_index
                && previous_meta.style == token.style
            {
                previous_meta.pm_to = token.pm_to;
                previous_meta.width += visual_width;
                previous_meta.text.push_str(&token.text);
                previous_run.pm_to = token.pm_to;
                previous_run.width += visual_width;
                previous_run.text.push_str(&token.text);
                left += visual_width;
                continue;
            }
        }

        let run = TextRunPosition {
            block_id: block_id.to_string(),
            pm_from: token.pm_from,
            pm_to: token.pm_to,
            left,
            baseline,
            width: visual_width,
            height: line_height_px,
            font_family: token.font_family.clone(),
            font_size,
            text: token.text.clone(),
        };
        text_runs.push(run.clone());
        merged_runs.push(MergedRun {
            source_run_index: token.source_run_index,
            style: token.style.clone(),
            pm_to: token.pm_to,
            width: visual_width,
            text: token.text.clone(),
        });
        left += visual_width;
    }

    if text_runs.is_empty() {
        return None;
    }

    Some(LayoutLine {
        id: format!("{}-l{}", block_id, line_index),
        block_id: block_id.to_string(),
        y: line_index as f32 * line_height_px,
        baseline,
        height: line_height_px.max(
            text_runs
                .iter()
                .map(|run| run.height)
                .max_by(|a: &f32, b: &f32| a.partial_cmp(b).unwrap_or(Ordering::Equal))
                .unwrap_or(0.0),
        ),
        text_runs,
    })
}

fn build_empty_line(
    block_id: &str,
    line_index: usize,
    font_size: f32,
    line_height_px: f32,
) -> LayoutLine {
    LayoutLine {
        id: format!("{}-l{}", block_id, line_index),
        block_id: block_id.to_string(),
        y: line_index as f32 * line_height_px,
        baseline: font_size,
        height: line_height_px,
        text_runs: Vec::new(),
    }
}

fn trim_range(tokens: &[Token], start: usize, end: usize) -> Option<(usize, usize)> {
    let mut trimmed_start = start;
    let mut trimmed_end = end;

    while trimmed_start < trimmed_end && tokens[trimmed_start].kind == TokenKind::Whitespace {
        trimmed_start += 1;
    }
    while trimmed_end > trimmed_start && tokens[trimmed_end - 1].kind == TokenKind::Whitespace {
        trimmed_end -= 1;
    }

    if trimmed_start >= trimmed_end {
        None
    } else {
        Some((trimmed_start, trimmed_end))
    }
}

fn measure_range_width(tokens: &[Token], start: usize, end: usize) -> f32 {
    let Some((trimmed_start, trimmed_end)) = trim_range(tokens, start, end) else {
        return 0.0;
    };

    tokens[trimmed_start..trimmed_end]
        .iter()
        .map(|token| token.width)
        .sum()
}

#[derive(Debug, Clone)]
struct MergedRun {
    source_run_index: usize,
    style: StyleSignature,
    pm_to: usize,
    width: f32,
    text: String,
}
