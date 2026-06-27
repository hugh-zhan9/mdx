use font_core::discovery::{discover_system_fonts, load_font_bytes};
use font_core::math_table::{math_constants, parse_glyph_assembly, parse_math_table};
use font_core::FontError;
use std::fs;
use std::path::Path;

/// Find a math font on the system.
fn find_math_font() -> Option<String> {
    let candidates = vec![
        "/System/Library/Fonts/Supplemental/STIXTwoMath.otf",
        "/Library/Fonts/STIXTwoMath.otf",
        "/System/Library/Fonts/Supplemental/InaiMathi-MN.ttc",
    ];

    for path in candidates {
        if Path::new(path).exists() {
            return Some(path.to_string());
        }
    }
    None
}

#[test]
fn test_parse_math_table_from_font_file() {
    let font_path = match find_math_font() {
        Some(path) => path,
        None => {
            eprintln!("Warning: No math font found on system. Skipping test.");
            return;
        }
    };

    let data = fs::read(&font_path).expect("Failed to read font file");
    let face = ttf_parser::Face::parse(&data, 0).expect("Failed to parse font face");

    let constants = parse_math_table(&face);

    if let Some(c) = constants {
        // Verify that we got reasonable values
        // Math constants should be non-zero for actual math fonts
        assert!(
            c.fraction_rule_thickness > 0.0,
            "fraction_rule_thickness should be positive"
        );
        assert!(
            c.radical_rule_thickness > 0.0,
            "radical_rule_thickness should be positive"
        );
        assert!(
            c.display_operator_min_height > 0.0,
            "display_operator_min_height should be positive"
        );

        println!("Successfully parsed MATH constants from {}", font_path);
        println!("  fraction_rule_thickness: {}", c.fraction_rule_thickness);
        println!("  radical_rule_thickness: {}", c.radical_rule_thickness);
        println!(
            "  display_operator_min_height: {}",
            c.display_operator_min_height
        );
    } else {
        panic!(
            "Expected MATH table constants from math font at {}",
            font_path
        );
    }
}

#[test]
fn test_font_without_math_table() {
    // Use a regular system font that should not have a MATH table
    let regular_fonts = vec![
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/SFNSText.ttf",
        "/Library/Fonts/Arial.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
    ];

    let mut found_regular_font = false;
    for font_path in regular_fonts {
        if !Path::new(font_path).exists() {
            continue;
        }

        found_regular_font = true;
        let data = fs::read(font_path).expect("Failed to read font file");
        let face = ttf_parser::Face::parse(&data, 0).expect("Failed to parse font face");

        let constants = parse_math_table(&face);
        assert!(
            constants.is_none(),
            "Regular font at {} should not have MATH table",
            font_path
        );

        println!(
            "Confirmed {} does not have MATH table (as expected)",
            font_path
        );
        break;
    }

    if !found_regular_font {
        eprintln!("Warning: No regular font found for negative test. Skipping.");
    }
}

#[test]
fn math_constants_report_unavailable_when_font_has_no_math_table() {
    let font = discover_system_fonts()
        .into_iter()
        .find(|font| font.math_checked && !font.math_available);

    if let Some(font) = font {
        let bytes = load_font_bytes(&font).expect("font bytes should load");
        assert!(matches!(
            math_constants(&bytes),
            Err(FontError::MathTableUnavailable)
        ));
    }
}

#[test]
fn test_parse_glyph_assembly() {
    let font_path = match find_math_font() {
        Some(path) => path,
        None => {
            eprintln!("Warning: No math font found on system. Skipping test.");
            return;
        }
    };

    let data = fs::read(&font_path).expect("Failed to read font file");
    let face = ttf_parser::Face::parse(&data, 0).expect("Failed to parse font face");

    // Try to find a glyph with assembly data
    // Common stretchable glyphs in math fonts:
    // - Parentheses: typically glyph IDs in the range 40-50
    // - Brackets: typically glyph IDs in the range 90-95
    // - Braces: typically glyph IDs in the range 123-125
    // We'll search through a reasonable range to find one with assembly

    let mut found_assembly = false;
    for glyph_id in 0..face.number_of_glyphs() {
        if let Some(assembly) = parse_glyph_assembly(&face, glyph_id as u32) {
            assert_eq!(assembly.glyph_id, glyph_id as u32);
            assert!(
                !assembly.parts.is_empty(),
                "Assembly should have at least one part"
            );

            // Verify each part has valid data
            for part in &assembly.parts {
                assert!(
                    part.glyph_id < face.number_of_glyphs() as u32,
                    "Part glyph_id should be valid"
                );
                assert!(
                    part.full_advance >= 0.0,
                    "Part full_advance should be non-negative"
                );
            }

            println!("Found glyph assembly for glyph_id {}", glyph_id);
            println!("  parts count: {}", assembly.parts.len());
            println!("  italics_correction: {}", assembly.italics_correction);

            found_assembly = true;
            break;
        }
    }

    if !found_assembly {
        println!("Note: No glyph assemblies found in this font (may be expected)");
    }
}
