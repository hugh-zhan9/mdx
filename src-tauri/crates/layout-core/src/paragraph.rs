use std::cmp::Ordering;

use crate::break_model::find_break_opportunities;
use crate::font_api::FontMetricsProvider;
use crate::{InlineKind, InlineRun, LayoutLine, TextRunPosition};

#[derive(Debug, Clone)]
pub struct ParagraphInput<'a> {
    pub block_id: String,
    pub inlines: &'a [InlineRun],
    pub line_width: f32,
    pub font_size: f32,
    pub line_height: f32,
    pub is_code: bool,
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
struct Token {
    kind: TokenKind,
    text: String,
    pm_from: usize,
    pm_to: usize,
    width: f32,
    break_after: bool,
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
    let line_height_px = input.font_size * input.line_height;
    let paragraphs = tokenize_paragraph(input, font_metrics);
    let mut lines = Vec::new();
    let mut line_index = 0usize;

    for tokens in paragraphs {
        if tokens.is_empty() {
            continue;
        }

        let mut breakpoints = vec![0usize];
        for (idx, token) in tokens.iter().enumerate() {
            if token.break_after {
                breakpoints.push(idx + 1);
            }
        }
        if breakpoints.last().copied() != Some(tokens.len()) {
            breakpoints.push(tokens.len());
        }

        if breakpoints.len() < 2 {
            return Err(ParagraphLayoutError::NoBreakCandidates);
        }

        let candidate_count = breakpoints.len();
        let mut dp = vec![f32::INFINITY; candidate_count];
        let mut prev = vec![None; candidate_count];
        dp[0] = 0.0;

        for end_idx in 1..candidate_count {
            for start_idx in 0..end_idx {
                let start = breakpoints[start_idx];
                let end = breakpoints[end_idx];
                if trim_range(&tokens, start, end).is_none() {
                    continue;
                }

                let width = measure_range_width(&tokens, start, end);
                if width <= 0.0 {
                    continue;
                }

                let overflow = (width - input.line_width).max(0.0);
                let slack = (input.line_width - width).max(0.0);
                let mut cost = if end_idx == candidate_count - 1 {
                    slack
                } else {
                    let ratio = if input.line_width > 0.0 {
                        slack / input.line_width
                    } else {
                        0.0
                    };
                    ratio.powi(3) * 1000.0
                };

                if overflow > 0.0 {
                    cost += 10_000.0 + overflow.powi(2) * 10.0;
                }

                let total = dp[start_idx] + cost;
                if total < dp[end_idx] {
                    dp[end_idx] = total;
                    prev[end_idx] = Some(start_idx);
                }
            }
        }

        let mut chosen = Vec::new();
        let mut cursor = candidate_count - 1;
        while let Some(previous) = prev[cursor] {
            chosen.push((breakpoints[previous], breakpoints[cursor]));
            cursor = previous;
        }
        if chosen.is_empty() {
            return Err(ParagraphLayoutError::NoBreakCandidates);
        }
        chosen.reverse();

        for (start, end) in chosen {
            if let Some(line) = build_line(
                &input.block_id,
                &tokens,
                start,
                end,
                line_index,
                input.font_size,
                line_height_px,
            ) {
                lines.push(line);
                line_index += 1;
            }
        }
    }

    Ok(lines)
}

/// Greedy line-breaking fallback used until full paragraph optimization is complete.
pub fn layout_paragraph_greedy(
    input: &ParagraphInput<'_>,
    font_metrics: &dyn FontMetricsProvider,
) -> Vec<LayoutLine> {
    let line_height_px = input.font_size * input.line_height;
    let paragraphs = tokenize_paragraph(input, font_metrics);
    let mut lines = Vec::new();
    let mut line_index = 0usize;

    for tokens in paragraphs {
        if tokens.is_empty() {
            continue;
        }

        let mut start = 0usize;
        let mut idx = 0usize;
        let mut last_break = None;

        while idx < tokens.len() {
            if tokens[idx].break_after {
                last_break = Some(idx + 1);
            }

            let width = measure_range_width(&tokens, start, idx + 1);
            if width > input.line_width {
                let end = last_break
                    .filter(|candidate| *candidate > start)
                    .unwrap_or(idx);

                if end == start {
                    if let Some(line) = build_line(
                        &input.block_id,
                        &tokens,
                        start,
                        idx + 1,
                        line_index,
                        input.font_size,
                        line_height_px,
                    ) {
                        lines.push(line);
                        line_index += 1;
                    }
                    start = idx + 1;
                    idx = start;
                    last_break = None;
                    continue;
                }

                if let Some(line) = build_line(
                    &input.block_id,
                    &tokens,
                    start,
                    end,
                    line_index,
                    input.font_size,
                    line_height_px,
                ) {
                    lines.push(line);
                    line_index += 1;
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
                &tokens,
                start,
                tokens.len(),
                line_index,
                input.font_size,
                line_height_px,
            ) {
                lines.push(line);
                line_index += 1;
            }
        }
    }

    lines
}

fn tokenize_paragraph(
    input: &ParagraphInput<'_>,
    font_metrics: &dyn FontMetricsProvider,
) -> Vec<Vec<Token>> {
    let mut paragraphs = Vec::new();
    let mut current = Vec::new();

    for run in input.inlines {
        if matches!(run.kind, InlineKind::HardBreak) {
            if !current.is_empty() {
                paragraphs.push(current);
                current = Vec::new();
            }
            continue;
        }

        current.extend(tokenize_run(run, input, font_metrics));
    }

    if !current.is_empty() {
        paragraphs.push(current);
    }

    paragraphs
}

fn tokenize_run(
    run: &InlineRun,
    input: &ParagraphInput<'_>,
    font_metrics: &dyn FontMetricsProvider,
) -> Vec<Token> {
    let text = run.text.as_str();
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
    let (trimmed_start, trimmed_end) = trim_range(tokens, start, end)?;
    let baseline = font_size;
    let mut text_runs: Vec<TextRunPosition> = Vec::new();
    let mut left = 0.0f32;

    for token in &tokens[trimmed_start..trimmed_end] {
        if let Some(previous) = text_runs.last_mut() {
            if previous.pm_to == token.pm_from {
                previous.pm_to = token.pm_to;
                previous.width += token.width;
                previous.text.push_str(&token.text);
                left += token.width;
                continue;
            }
        }

        text_runs.push(TextRunPosition {
            block_id: block_id.to_string(),
            pm_from: token.pm_from,
            pm_to: token.pm_to,
            left,
            baseline,
            width: token.width,
            height: line_height_px,
            font_family: "default".to_string(),
            font_size,
            text: token.text.clone(),
        });
        left += token.width;
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
