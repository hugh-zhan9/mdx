use std::io::Cursor;
use std::time::Instant;

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use layout_core::{
    CanvasDrawKind, CanvasDrawOp, CaretAnchor, HitTestEntry, LayoutLine, LayoutSnapshot,
    MirrorBlock, Rect, SelectionGeometry, TextRunPosition,
};
use lopdf::{
    content::{Content, Operation},
    dictionary, Dictionary, Document, Object, ObjectId, Stream,
};
use serde::Deserialize;
use serde_json::Value;

use crate::model::{PdfExportRequest, PdfExportResult};
use crate::pagination::paginate_snapshot;

pub fn export_pdf(request: &PdfExportRequest) -> Result<PdfExportResult, String> {
    let started = Instant::now();
    let snapshot = parse_layout_snapshot(&request.layout_snapshot_json)?;
    let paginated = paginate_snapshot(&snapshot, &request.page_size, &request.margins);
    let mut warnings = Vec::new();

    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let font_id = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica",
    });

    let mut page_ids = Vec::new();
    let page_count = paginated.pages.len().max(1);
    for page_index in 0..page_count {
        let page = paginated.pages.get(page_index);
        let mut content = Content {
            operations: Vec::new(),
        };
        let mut xobjects: Vec<(Vec<u8>, ObjectId)> = Vec::new();
        let page_start_y = page
            .and_then(|page| page.lines.first())
            .map(|line| line.y)
            .unwrap_or_default();

        for line in page.map(|page| page.lines.as_slice()).unwrap_or(&[]) {
            let line_local_y = line.y - page_start_y;
            for run in &line.text_runs {
                content.operations.push(Operation::new("BT", vec![]));
                content.operations.push(Operation::new(
                    "Tf",
                    vec![Object::Name(b"F1".to_vec()), run.font_size.into()],
                ));
                content.operations.push(Operation::new(
                    "Td",
                    vec![
                        run.left.into(),
                        (request.page_size.height_pt
                            - request.margins.top_pt
                            - (line_local_y + (run.baseline - line.baseline)))
                            .into(),
                    ],
                ));
                content.operations.push(Operation::new(
                    "Tj",
                    vec![Object::string_literal(run.text.clone())],
                ));
                content.operations.push(Operation::new("ET", vec![]));
            }
        }

        for draw_op in page.map(|page| page.draw_ops.as_slice()).unwrap_or(&[]) {
            match draw_op.kind {
                CanvasDrawKind::TableGrid | CanvasDrawKind::Decoration => {
                    draw_rect_outline(&mut content, request, draw_op);
                }
                CanvasDrawKind::CodeHighlight => {
                    draw_code_highlight(&mut content, request, draw_op, font_id);
                }
                CanvasDrawKind::Math => {
                    draw_math_op(&mut content, request, draw_op, font_id)?;
                }
                CanvasDrawKind::Image => {
                    draw_image_op(&mut doc, &mut content, request, draw_op, &mut xobjects)?;
                }
                CanvasDrawKind::Mermaid => {
                    draw_mermaid_op(&mut content, request, draw_op, font_id, &mut warnings);
                }
            }
        }

        let content_id = doc.add_object(Stream::new(
            dictionary! {},
            content.encode().map_err(|error| error.to_string())?,
        ));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "Contents" => content_id,
            "Resources" => dictionary! {
                "Font" => dictionary! { "F1" => font_id },
                "XObject" => xobject_dictionary(xobjects)
            },
            "MediaBox" => vec![
                0.into(),
                0.into(),
                request.page_size.width_pt.into(),
                request.page_size.height_pt.into()
            ],
        });
        page_ids.push(page_id);
    }

    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => page_ids.iter().copied().map(Object::Reference).collect::<Vec<_>>(),
            "Count" => page_ids.len() as i64,
        }),
    );
    let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog_id);
    doc.compress();
    doc.save(&request.output_path)
        .map_err(|error| error.to_string())?;

    Ok(PdfExportResult {
        page_count: page_ids.len(),
        warnings,
        export_ms: started.elapsed().as_millis() as u64,
    })
}

fn draw_rect_outline(content: &mut Content, request: &PdfExportRequest, draw_op: &CanvasDrawOp) {
    let top = pdf_top(request, draw_op.y, draw_op.height);
    content.operations.push(Operation::new("q", vec![]));
    content.operations.push(Operation::new("w", vec![1.into()]));
    content.operations.push(Operation::new(
        "re",
        vec![
            draw_op.x.into(),
            top.into(),
            draw_op.width.into(),
            draw_op.height.into(),
        ],
    ));
    content.operations.push(Operation::new("S", vec![]));
    content.operations.push(Operation::new("Q", vec![]));
}

fn draw_filled_rect(content: &mut Content, request: &PdfExportRequest, draw_op: &CanvasDrawOp) {
    let top = pdf_top(request, draw_op.y, draw_op.height);
    content.operations.push(Operation::new("q", vec![]));
    content.operations.push(Operation::new(
        "rg",
        vec![0.94.into(), 0.94.into(), 0.94.into()],
    ));
    content.operations.push(Operation::new(
        "re",
        vec![
            draw_op.x.into(),
            top.into(),
            draw_op.width.into(),
            draw_op.height.into(),
        ],
    ));
    content.operations.push(Operation::new("f", vec![]));
    content.operations.push(Operation::new("Q", vec![]));
}

fn draw_code_highlight(
    content: &mut Content,
    request: &PdfExportRequest,
    draw_op: &CanvasDrawOp,
    font_id: lopdf::ObjectId,
) {
    draw_filled_rect(content, request, draw_op);
    if let Some(text) = text_from_data(&draw_op.data) {
        write_text(
            content,
            font_id,
            10.0,
            draw_op.x + 4.0,
            pdf_text_y(request, draw_op.y + 14.0),
            &text,
        );
    }
}

fn draw_math_op(
    content: &mut Content,
    request: &PdfExportRequest,
    draw_op: &CanvasDrawOp,
    font_id: lopdf::ObjectId,
) -> Result<(), String> {
    let value = parse_draw_data(&draw_op.data)?;
    match value.get("type").and_then(Value::as_str) {
        Some("text") => {
            let text = value
                .get("content")
                .and_then(Value::as_str)
                .ok_or_else(|| format!("math draw op {} missing text content", draw_op.block_id))?;
            write_text(
                content,
                font_id,
                draw_op.height.max(8.0) * 0.7,
                draw_op.x,
                pdf_text_y(request, draw_op.y + draw_op.height * 0.75),
                text,
            );
        }
        Some("frac_line") => draw_horizontal_rule(content, request, draw_op),
        Some("radical") => draw_radical(content, request, draw_op),
        Some("bigop") => {
            let name = value.get("name").and_then(Value::as_str).unwrap_or("");
            write_text(
                content,
                font_id,
                draw_op.height.max(10.0) * 0.8,
                draw_op.x,
                pdf_text_y(request, draw_op.y + draw_op.height * 0.85),
                math_bigop_text(name),
            );
        }
        Some("error") => {
            return Err(format!(
                "math draw op {} contains layout error",
                draw_op.block_id
            ));
        }
        _ => {
            if let Some(text) = text_from_value(&value) {
                write_text(
                    content,
                    font_id,
                    draw_op.height.max(8.0) * 0.7,
                    draw_op.x,
                    pdf_text_y(request, draw_op.y + draw_op.height * 0.75),
                    &text,
                );
            } else {
                return Err(format!(
                    "math draw op {} has unsupported data",
                    draw_op.block_id
                ));
            }
        }
    }

    Ok(())
}

fn draw_mermaid_op(
    content: &mut Content,
    request: &PdfExportRequest,
    draw_op: &CanvasDrawOp,
    font_id: lopdf::ObjectId,
    warnings: &mut Vec<String>,
) {
    if let Some(svg) = svg_from_data(&draw_op.data) {
        draw_svg_subset(content, request, draw_op, font_id, &svg, warnings);
    } else if let Some(text) = text_from_data(&draw_op.data) {
        write_text(
            content,
            font_id,
            10.0,
            draw_op.x + 4.0,
            pdf_text_y(request, draw_op.y + 14.0),
            &text,
        );
    } else {
        warnings.push(format!(
            "Mermaid draw op for block {} exported without source text",
            draw_op.block_id
        ));
    }
}

fn draw_image_op(
    doc: &mut Document,
    content: &mut Content,
    request: &PdfExportRequest,
    draw_op: &CanvasDrawOp,
    xobjects: &mut Vec<(Vec<u8>, ObjectId)>,
) -> Result<(), String> {
    let value = parse_draw_data(&draw_op.data)?;
    let encoded = value
        .get("bytesBase64")
        .or_else(|| value.get("bytes_base64"))
        .and_then(Value::as_str)
        .ok_or_else(|| format!("image draw op {} missing image bytes", draw_op.block_id))?;
    let mime_type = value
        .get("mimeType")
        .or_else(|| value.get("mime_type"))
        .and_then(Value::as_str)
        .unwrap_or("image/jpeg");
    let bytes = BASE64_STANDARD.decode(encoded).map_err(|error| {
        format!(
            "image draw op {} has invalid base64: {error}",
            draw_op.block_id
        )
    })?;
    let image_id = match mime_type {
        "image/jpeg" | "image/jpg" => {
            let image_width = numeric_value(&value, "imageWidth")
                .or_else(|| numeric_value(&value, "widthPx"))
                .unwrap_or(draw_op.width.max(1.0)) as i64;
            let image_height = numeric_value(&value, "imageHeight")
                .or_else(|| numeric_value(&value, "heightPx"))
                .unwrap_or(draw_op.height.max(1.0)) as i64;
            add_jpeg_xobject(doc, image_width, image_height, bytes)
        }
        "image/png" => add_png_xobject(doc, &draw_op.block_id, &bytes)?,
        _ => {
            return Err(format!(
                "image draw op {} has unsupported image MIME type {mime_type}",
                draw_op.block_id
            ));
        }
    };
    let name = format!("Im{}", xobjects.len() + 1).into_bytes();
    xobjects.push((name.clone(), image_id));

    let top = pdf_top(request, draw_op.y, draw_op.height);
    content.operations.push(Operation::new("q", vec![]));
    content.operations.push(Operation::new(
        "cm",
        vec![
            draw_op.width.into(),
            0.into(),
            0.into(),
            draw_op.height.into(),
            draw_op.x.into(),
            top.into(),
        ],
    ));
    content
        .operations
        .push(Operation::new("Do", vec![Object::Name(name)]));
    content.operations.push(Operation::new("Q", vec![]));

    Ok(())
}

fn draw_horizontal_rule(content: &mut Content, request: &PdfExportRequest, draw_op: &CanvasDrawOp) {
    let y = pdf_text_y(request, draw_op.y + draw_op.height / 2.0);
    content.operations.push(Operation::new("q", vec![]));
    content.operations.push(Operation::new("w", vec![1.into()]));
    content
        .operations
        .push(Operation::new("m", vec![draw_op.x.into(), y.into()]));
    content.operations.push(Operation::new(
        "l",
        vec![(draw_op.x + draw_op.width).into(), y.into()],
    ));
    content.operations.push(Operation::new("S", vec![]));
    content.operations.push(Operation::new("Q", vec![]));
}

fn draw_radical(content: &mut Content, request: &PdfExportRequest, draw_op: &CanvasDrawOp) {
    let left = draw_op.x;
    let bottom = pdf_top(request, draw_op.y, draw_op.height);
    let top = bottom + draw_op.height;
    content.operations.push(Operation::new("q", vec![]));
    content.operations.push(Operation::new("w", vec![1.into()]));
    content.operations.push(Operation::new(
        "m",
        vec![left.into(), (bottom + draw_op.height * 0.35).into()],
    ));
    content.operations.push(Operation::new(
        "l",
        vec![(left + draw_op.width * 0.2).into(), bottom.into()],
    ));
    content.operations.push(Operation::new(
        "l",
        vec![(left + draw_op.width * 0.35).into(), top.into()],
    ));
    content.operations.push(Operation::new(
        "l",
        vec![(left + draw_op.width).into(), top.into()],
    ));
    content.operations.push(Operation::new("S", vec![]));
    content.operations.push(Operation::new("Q", vec![]));
}

fn draw_svg_subset(
    content: &mut Content,
    request: &PdfExportRequest,
    draw_op: &CanvasDrawOp,
    font_id: lopdf::ObjectId,
    svg: &str,
    warnings: &mut Vec<String>,
) {
    let mut drew_supported_node = false;

    for tag in svg_tags(svg, "rect") {
        let x = draw_op.x + attr_f32(tag, "x").unwrap_or_default();
        let y = draw_op.y + attr_f32(tag, "y").unwrap_or_default();
        let width = attr_f32(tag, "width").unwrap_or_default();
        let height = attr_f32(tag, "height").unwrap_or_default();
        draw_svg_rect(content, request, x, y, width, height);
        drew_supported_node = true;
    }

    for tag in svg_tags(svg, "line") {
        let x1 = draw_op.x + attr_f32(tag, "x1").unwrap_or_default();
        let y1 = draw_op.y + attr_f32(tag, "y1").unwrap_or_default();
        let x2 = draw_op.x + attr_f32(tag, "x2").unwrap_or_default();
        let y2 = draw_op.y + attr_f32(tag, "y2").unwrap_or_default();
        draw_svg_line(content, request, x1, y1, x2, y2);
        drew_supported_node = true;
    }

    for tag in svg_tags(svg, "circle") {
        let cx = draw_op.x + attr_f32(tag, "cx").unwrap_or_default();
        let cy = draw_op.y + attr_f32(tag, "cy").unwrap_or_default();
        let radius = attr_f32(tag, "r").unwrap_or_default();
        draw_svg_circle(content, request, cx, cy, radius);
        drew_supported_node = true;
    }

    for tag in svg_tags(svg, "polyline")
        .into_iter()
        .chain(svg_tags(svg, "polygon"))
    {
        if let Some(points) = attr_value(tag, "points").and_then(parse_points) {
            draw_svg_polyline(content, request, draw_op, &points);
            drew_supported_node = true;
        }
    }

    for tag in svg_tags(svg, "path") {
        if let Some(path) = attr_value(tag, "d") {
            if draw_svg_path(content, request, draw_op, path) {
                drew_supported_node = true;
            } else {
                warnings.push(format!(
                    "Mermaid draw op for block {} contains unsupported SVG path data",
                    draw_op.block_id
                ));
            }
        }
    }

    for text_node in svg_text_nodes(svg) {
        write_text(
            content,
            font_id,
            attr_f32(text_node.tag, "font-size").unwrap_or(10.0),
            draw_op.x + attr_f32(text_node.tag, "x").unwrap_or_default(),
            pdf_text_y(
                request,
                draw_op.y + attr_f32(text_node.tag, "y").unwrap_or(12.0),
            ),
            text_node.text.trim(),
        );
        drew_supported_node = true;
    }

    if !drew_supported_node {
        warnings.push(format!(
            "Mermaid draw op for block {} did not contain supported SVG subset nodes",
            draw_op.block_id
        ));
    }
}

fn draw_svg_rect(
    content: &mut Content,
    request: &PdfExportRequest,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
) {
    content.operations.push(Operation::new("q", vec![]));
    content.operations.push(Operation::new(
        "re",
        vec![
            x.into(),
            pdf_top(request, y, height).into(),
            width.into(),
            height.into(),
        ],
    ));
    content.operations.push(Operation::new("S", vec![]));
    content.operations.push(Operation::new("Q", vec![]));
}

fn draw_svg_line(
    content: &mut Content,
    request: &PdfExportRequest,
    x1: f32,
    y1: f32,
    x2: f32,
    y2: f32,
) {
    content.operations.push(Operation::new("q", vec![]));
    content.operations.push(Operation::new(
        "m",
        vec![x1.into(), pdf_text_y(request, y1).into()],
    ));
    content.operations.push(Operation::new(
        "l",
        vec![x2.into(), pdf_text_y(request, y2).into()],
    ));
    content.operations.push(Operation::new("S", vec![]));
    content.operations.push(Operation::new("Q", vec![]));
}

fn draw_svg_circle(
    content: &mut Content,
    request: &PdfExportRequest,
    cx: f32,
    cy: f32,
    radius: f32,
) {
    if radius <= 0.0 {
        return;
    }

    let kappa = 0.552_284_8 * radius;
    let center_y = pdf_text_y(request, cy);
    content.operations.push(Operation::new("q", vec![]));
    content.operations.push(Operation::new(
        "m",
        vec![(cx + radius).into(), center_y.into()],
    ));
    content.operations.push(Operation::new(
        "c",
        vec![
            (cx + radius).into(),
            (center_y - kappa).into(),
            (cx + kappa).into(),
            (center_y - radius).into(),
            cx.into(),
            (center_y - radius).into(),
        ],
    ));
    content.operations.push(Operation::new(
        "c",
        vec![
            (cx - kappa).into(),
            (center_y - radius).into(),
            (cx - radius).into(),
            (center_y - kappa).into(),
            (cx - radius).into(),
            center_y.into(),
        ],
    ));
    content.operations.push(Operation::new(
        "c",
        vec![
            (cx - radius).into(),
            (center_y + kappa).into(),
            (cx - kappa).into(),
            (center_y + radius).into(),
            cx.into(),
            (center_y + radius).into(),
        ],
    ));
    content.operations.push(Operation::new(
        "c",
        vec![
            (cx + kappa).into(),
            (center_y + radius).into(),
            (cx + radius).into(),
            (center_y + kappa).into(),
            (cx + radius).into(),
            center_y.into(),
        ],
    ));
    content.operations.push(Operation::new("S", vec![]));
    content.operations.push(Operation::new("Q", vec![]));
}

fn draw_svg_polyline(
    content: &mut Content,
    request: &PdfExportRequest,
    draw_op: &CanvasDrawOp,
    points: &[(f32, f32)],
) {
    if points.len() < 2 {
        return;
    }

    content.operations.push(Operation::new("q", vec![]));
    content.operations.push(Operation::new(
        "m",
        vec![
            (draw_op.x + points[0].0).into(),
            pdf_text_y(request, draw_op.y + points[0].1).into(),
        ],
    ));
    for (x, y) in &points[1..] {
        content.operations.push(Operation::new(
            "l",
            vec![
                (draw_op.x + *x).into(),
                pdf_text_y(request, draw_op.y + *y).into(),
            ],
        ));
    }
    content.operations.push(Operation::new("S", vec![]));
    content.operations.push(Operation::new("Q", vec![]));
}

fn draw_svg_path(
    content: &mut Content,
    request: &PdfExportRequest,
    draw_op: &CanvasDrawOp,
    path: &str,
) -> bool {
    let points = parse_simple_path_points(path);
    if points.len() < 2 {
        return false;
    }
    draw_svg_polyline(content, request, draw_op, &points);
    true
}

fn xobject_dictionary(xobjects: Vec<(Vec<u8>, ObjectId)>) -> Dictionary {
    let mut dictionary = Dictionary::new();
    for (name, object_id) in xobjects {
        dictionary.set(name, Object::Reference(object_id));
    }
    dictionary
}

fn add_jpeg_xobject(
    doc: &mut Document,
    image_width: i64,
    image_height: i64,
    bytes: Vec<u8>,
) -> ObjectId {
    doc.add_object(Stream::new(
        dictionary! {
            "Type" => "XObject",
            "Subtype" => "Image",
            "Width" => image_width,
            "Height" => image_height,
            "ColorSpace" => "DeviceRGB",
            "BitsPerComponent" => 8,
            "Filter" => "DCTDecode",
        },
        bytes,
    ))
}

fn add_png_xobject(doc: &mut Document, block_id: &str, bytes: &[u8]) -> Result<ObjectId, String> {
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder
        .read_info()
        .map_err(|error| format!("image draw op {block_id} has invalid PNG data: {error}"))?;
    let mut buffer = vec![0; reader.output_buffer_size()];
    let info = reader
        .next_frame(&mut buffer)
        .map_err(|error| format!("image draw op {block_id} has invalid PNG frame: {error}"))?;
    let raw = &buffer[..info.buffer_size()];
    let rgb = png_frame_to_rgb(block_id, info.color_type, raw)?;

    Ok(doc.add_object(Stream::new(
        dictionary! {
            "Type" => "XObject",
            "Subtype" => "Image",
            "Width" => i64::from(info.width),
            "Height" => i64::from(info.height),
            "ColorSpace" => "DeviceRGB",
            "BitsPerComponent" => 8,
        },
        rgb,
    )))
}

fn png_frame_to_rgb(
    block_id: &str,
    color_type: png::ColorType,
    raw: &[u8],
) -> Result<Vec<u8>, String> {
    match color_type {
        png::ColorType::Rgb => Ok(raw.to_vec()),
        png::ColorType::Rgba => Ok(raw
            .chunks_exact(4)
            .flat_map(|pixel| [pixel[0], pixel[1], pixel[2]])
            .collect()),
        png::ColorType::Grayscale => Ok(raw
            .iter()
            .flat_map(|value| [*value, *value, *value])
            .collect()),
        png::ColorType::GrayscaleAlpha => Ok(raw
            .chunks_exact(2)
            .flat_map(|pixel| [pixel[0], pixel[0], pixel[0]])
            .collect()),
        png::ColorType::Indexed => Err(format!(
            "image draw op {block_id} decoded to unsupported indexed PNG data"
        )),
    }
}

fn write_text(
    content: &mut Content,
    font_id: lopdf::ObjectId,
    font_size: f32,
    x: f32,
    y: f32,
    text: &str,
) {
    content.operations.push(Operation::new("BT", vec![]));
    content.operations.push(Operation::new(
        "Tf",
        vec![Object::Name(resource_font_name(font_id)), font_size.into()],
    ));
    content
        .operations
        .push(Operation::new("Td", vec![x.into(), y.into()]));
    content.operations.push(Operation::new(
        "Tj",
        vec![Object::string_literal(text.to_string())],
    ));
    content.operations.push(Operation::new("ET", vec![]));
}

fn resource_font_name(_font_id: lopdf::ObjectId) -> Vec<u8> {
    b"F1".to_vec()
}

fn pdf_top(request: &PdfExportRequest, y: f32, height: f32) -> f32 {
    request.page_size.height_pt - request.margins.top_pt - y - height
}

fn pdf_text_y(request: &PdfExportRequest, y: f32) -> f32 {
    request.page_size.height_pt - request.margins.top_pt - y
}

fn parse_draw_data(data: &str) -> Result<Value, String> {
    serde_json::from_str(data).map_err(|error| format!("invalid draw op data: {error}"))
}

fn text_from_data(data: &str) -> Option<String> {
    parse_draw_data(data)
        .ok()
        .and_then(|value| text_from_value(&value))
        .or_else(|| (!data.trim().is_empty()).then(|| data.to_string()))
}

fn svg_from_data(data: &str) -> Option<String> {
    parse_draw_data(data)
        .ok()
        .and_then(|value| {
            value
                .get("svg")
                .and_then(Value::as_str)
                .or_else(|| value.get("content").and_then(Value::as_str))
                .filter(|content| content.trim_start().starts_with("<svg"))
                .map(ToOwned::to_owned)
        })
        .or_else(|| {
            data.trim_start()
                .starts_with("<svg")
                .then(|| data.to_string())
        })
}

fn text_from_value(value: &Value) -> Option<String> {
    value
        .get("text")
        .and_then(Value::as_str)
        .or_else(|| value.get("content").and_then(Value::as_str))
        .or_else(|| value.get("code").and_then(Value::as_str))
        .map(ToOwned::to_owned)
}

fn numeric_value(value: &Value, key: &str) -> Option<f32> {
    value
        .get(key)
        .and_then(|value| value.as_f64().map(|number| number as f32))
}

fn svg_tags<'a>(svg: &'a str, tag_name: &str) -> Vec<&'a str> {
    let mut tags = Vec::new();
    let needle = format!("<{tag_name}");
    let mut remaining = svg;
    while let Some(start) = remaining.find(&needle) {
        let after_start = &remaining[start..];
        let Some(end) = after_start.find('>') else {
            break;
        };
        tags.push(&after_start[..=end]);
        remaining = &after_start[end + 1..];
    }
    tags
}

struct SvgTextNode<'a> {
    tag: &'a str,
    text: &'a str,
}

fn svg_text_nodes(svg: &str) -> Vec<SvgTextNode<'_>> {
    let mut nodes = Vec::new();
    let mut remaining = svg;
    while let Some(start) = remaining.find("<text") {
        let after_start = &remaining[start..];
        let Some(tag_end) = after_start.find('>') else {
            break;
        };
        let Some(close_start) = after_start[tag_end + 1..].find("</text>") else {
            break;
        };
        nodes.push(SvgTextNode {
            tag: &after_start[..=tag_end],
            text: &after_start[tag_end + 1..tag_end + 1 + close_start],
        });
        remaining = &after_start[tag_end + 1 + close_start + "</text>".len()..];
    }
    nodes
}

fn attr_f32(tag: &str, name: &str) -> Option<f32> {
    attr_value(tag, name)?.parse().ok()
}

fn attr_value<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let needle = format!("{name}=");
    let start = tag.find(&needle)? + needle.len();
    let quote = tag.as_bytes().get(start).copied()?;
    if quote != b'"' && quote != b'\'' {
        return None;
    }
    let value_start = start + 1;
    let value_end = tag[value_start..].find(quote as char)? + value_start;
    Some(&tag[value_start..value_end])
}

fn parse_points(points: &str) -> Option<Vec<(f32, f32)>> {
    let parsed = points
        .split_whitespace()
        .filter_map(|pair| {
            let (x, y) = pair.split_once(',')?;
            Some((x.parse().ok()?, y.parse().ok()?))
        })
        .collect::<Vec<_>>();
    (!parsed.is_empty()).then_some(parsed)
}

fn parse_simple_path_points(path: &str) -> Vec<(f32, f32)> {
    let mut normalized = String::with_capacity(path.len() * 2);
    for char in path.chars() {
        if char == ',' {
            normalized.push(' ');
        } else if matches!(
            char,
            'M' | 'm' | 'L' | 'l' | 'H' | 'h' | 'V' | 'v' | 'Z' | 'z'
        ) {
            normalized.push(' ');
            normalized.push(char);
            normalized.push(' ');
        } else {
            normalized.push(char);
        }
    }

    let mut points = Vec::new();
    let mut cursor = normalized.split_whitespace();
    while let Some(token) = cursor.next() {
        match token {
            "M" | "m" | "L" | "l" => {
                let Some(x) = cursor.next().and_then(|value| value.parse().ok()) else {
                    return Vec::new();
                };
                let Some(y) = cursor.next().and_then(|value| value.parse().ok()) else {
                    return Vec::new();
                };
                points.push((x, y));
            }
            "H" | "h" => {
                let Some(x) = cursor.next().and_then(|value| value.parse().ok()) else {
                    return Vec::new();
                };
                let y = points.last().map(|point| point.1).unwrap_or_default();
                points.push((x, y));
            }
            "V" | "v" => {
                let Some(y) = cursor.next().and_then(|value| value.parse().ok()) else {
                    return Vec::new();
                };
                let x = points.last().map(|point| point.0).unwrap_or_default();
                points.push((x, y));
            }
            "Z" | "z" => {
                if let Some(first) = points.first().copied() {
                    points.push(first);
                }
            }
            _ => {}
        }
    }
    points
}

fn math_bigop_text(name: &str) -> &str {
    match name {
        "sum" => "SUM",
        "prod" => "PROD",
        "int" => "INT",
        other => other,
    }
}

fn parse_layout_snapshot(snapshot_json: &str) -> Result<LayoutSnapshot, String> {
    let snapshot: LayoutSnapshotCompat =
        serde_json::from_str(snapshot_json).map_err(|error| error.to_string())?;

    Ok(LayoutSnapshot {
        revision: snapshot.revision,
        lines: snapshot.lines.into_iter().map(Into::into).collect(),
        canvas_draw_ops: snapshot
            .canvas_draw_ops
            .into_iter()
            .map(Into::into)
            .collect(),
        hit_test_entries: snapshot
            .hit_test_entries
            .into_iter()
            .map(Into::into)
            .collect(),
        caret_anchors: snapshot.caret_anchors.into_iter().map(Into::into).collect(),
        selection_geometries: snapshot
            .selection_geometries
            .into_iter()
            .map(Into::into)
            .collect(),
        mirror_blocks: snapshot.mirror_blocks.into_iter().map(Into::into).collect(),
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LayoutSnapshotCompat {
    revision: u64,
    lines: Vec<LayoutLineCompat>,
    canvas_draw_ops: Vec<CanvasDrawOpCompat>,
    hit_test_entries: Vec<HitTestEntryCompat>,
    caret_anchors: Vec<CaretAnchorCompat>,
    selection_geometries: Vec<SelectionGeometryCompat>,
    mirror_blocks: Vec<MirrorBlockCompat>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LayoutLineCompat {
    id: String,
    block_id: String,
    y: f32,
    baseline: f32,
    height: f32,
    text_runs: Vec<TextRunPositionCompat>,
}

impl From<LayoutLineCompat> for LayoutLine {
    fn from(value: LayoutLineCompat) -> Self {
        Self {
            id: value.id,
            block_id: value.block_id,
            y: value.y,
            baseline: value.baseline,
            height: value.height,
            text_runs: value.text_runs.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TextRunPositionCompat {
    block_id: String,
    pm_from: usize,
    pm_to: usize,
    left: f32,
    baseline: f32,
    width: f32,
    height: f32,
    font_family: String,
    font_size: f32,
    text: String,
}

impl From<TextRunPositionCompat> for TextRunPosition {
    fn from(value: TextRunPositionCompat) -> Self {
        Self {
            block_id: value.block_id,
            pm_from: value.pm_from,
            pm_to: value.pm_to,
            left: value.left,
            baseline: value.baseline,
            width: value.width,
            height: value.height,
            font_family: value.font_family,
            font_size: value.font_size,
            text: value.text,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CanvasDrawOpCompat {
    block_id: String,
    kind: CanvasDrawKind,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    data: String,
}

impl From<CanvasDrawOpCompat> for CanvasDrawOp {
    fn from(value: CanvasDrawOpCompat) -> Self {
        Self {
            block_id: value.block_id,
            kind: value.kind,
            x: value.x,
            y: value.y,
            width: value.width,
            height: value.height,
            data: value.data,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HitTestEntryCompat {
    block_id: String,
    rect: Rect,
    pm_from: usize,
    pm_to: usize,
}

impl From<HitTestEntryCompat> for HitTestEntry {
    fn from(value: HitTestEntryCompat) -> Self {
        Self {
            block_id: value.block_id,
            rect: value.rect,
            pm_from: value.pm_from,
            pm_to: value.pm_to,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CaretAnchorCompat {
    line_id: String,
    pm_position: usize,
    x: f32,
    y: f32,
    height: f32,
}

impl From<CaretAnchorCompat> for CaretAnchor {
    fn from(value: CaretAnchorCompat) -> Self {
        Self {
            line_id: value.line_id,
            pm_position: value.pm_position,
            x: value.x,
            y: value.y,
            height: value.height,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SelectionGeometryCompat {
    pm_from: usize,
    pm_to: usize,
    rects: Vec<Rect>,
}

impl From<SelectionGeometryCompat> for SelectionGeometry {
    fn from(value: SelectionGeometryCompat) -> Self {
        Self {
            pm_from: value.pm_from,
            pm_to: value.pm_to,
            rects: value.rects,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MirrorBlockCompat {
    block_id: String,
    pm_from: usize,
    pm_to: usize,
    semantic_text: String,
    aria_label: String,
}

impl From<MirrorBlockCompat> for MirrorBlock {
    fn from(value: MirrorBlockCompat) -> Self {
        Self {
            block_id: value.block_id,
            pm_from: value.pm_from,
            pm_to: value.pm_to,
            semantic_text: value.semantic_text,
            aria_label: value.aria_label,
        }
    }
}
