pub mod export;
pub mod model;
pub mod pagination;

/// The PDF object model this crate writes.
///
/// Re-exported so a caller can read an exported document back and check what
/// reached the page, rather than trusting that the export said it succeeded.
pub use lopdf;

pub use export::export_pdf;
pub use pagination::{paginate_snapshot, PaginatedDocument, PaginatedPage};
