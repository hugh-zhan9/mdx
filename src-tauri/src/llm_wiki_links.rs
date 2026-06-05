#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StableWikiLink {
    pub target: String,
    pub label: Option<String>,
}

pub fn extract_stable_wikilinks(contents: &str) -> Vec<StableWikiLink> {
    let mut links = Vec::new();
    let mut remaining = contents;

    while let Some(start) = remaining.find("[[") {
        remaining = &remaining[start + 2..];
        let Some(end) = remaining.find("]]") else {
            break;
        };

        let raw = &remaining[..end];
        let mut parts = raw.splitn(2, '|');
        let target = parts.next().unwrap_or("").trim();
        let label = parts
            .next()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);

        if is_stable_wiki_link_target(target) {
            links.push(StableWikiLink {
                target: target.to_string(),
                label,
            });
        }

        remaining = &remaining[end + 2..];
    }

    links
}

pub fn is_stable_wiki_link_target(target: &str) -> bool {
    let target = target.split('#').next().unwrap_or("").trim();
    let Some((section, slug)) = target.split_once('/') else {
        return false;
    };

    matches!(section, "sources" | "entities" | "concepts" | "syntheses")
        && is_ascii_slug_path(slug)
}

pub fn resolve_wiki_link_target(target: &str) -> Option<String> {
    let target = target.split('#').next().unwrap_or("").trim();
    if !is_stable_wiki_link_target(target) {
        return None;
    }

    Some(format!("wiki/{target}.md"))
}

fn is_ascii_slug_path(value: &str) -> bool {
    !value.is_empty()
        && !value.contains("//")
        && value.split('/').all(|segment| {
            !segment.is_empty()
                && segment != "."
                && segment != ".."
                && segment.bytes().all(|byte| {
                    byte.is_ascii_lowercase()
                        || byte.is_ascii_digit()
                        || byte == b'-'
                        || byte == b'_'
                })
        })
}
