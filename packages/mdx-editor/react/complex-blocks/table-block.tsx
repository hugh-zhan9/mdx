import type { ComplexBlockOp } from "./index";

type TableRow = string[];

export function TableBlock({ op }: { op: ComplexBlockOp }) {
    const rows = readRows(op.data);

    return (
        <div
            data-complex-block-id={op.blockId}
            data-complex-block-kind="table"
        >
            <table>
                <tbody>
                    {rows.map((row, rowIndex) => (
                        <tr key={`${op.blockId ?? "table"}-${rowIndex}`}>
                            {row.map((cell, cellIndex) => (
                                <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function readRows(data: ComplexBlockOp["data"]): TableRow[] {
    if (!data || typeof data !== "object") {
        return [];
    }

    const rows = readRowList((data as Record<string, unknown>).rows);
    if (rows.length > 0) {
        return rows;
    }

    const headers = readStringList((data as Record<string, unknown>).headers);
    const body = readRowList((data as Record<string, unknown>).cells);

    if (headers.length === 0) {
        return body;
    }

    return [headers, ...body];
}

function readRowList(value: unknown): TableRow[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((row) => readStringList(row))
        .filter((row) => row.length > 0);
}

function readStringList(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.map((cell) => String(cell));
}
