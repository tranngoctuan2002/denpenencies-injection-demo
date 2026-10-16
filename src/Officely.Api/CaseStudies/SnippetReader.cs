namespace Officely.Api.CaseStudies;

/// <summary>
/// Reads "// #region snippet:name" ... "// #endregion" blocks from this project's .cs files,
/// so the code panels in the UI always show the code that actually runs.
/// Same idea as DiDemo.Web's SnippetReader, scoped to this project so snippet names cannot collide.
/// </summary>
public sealed class SnippetReader
{
    private const string Start = "// #region snippet:";
    private readonly Dictionary<string, string> _snippets = new(StringComparer.OrdinalIgnoreCase);

    // shortcut: needs the .cs sources next to the app (true for `dotnet run`), a published build shows "not found".
    public SnippetReader(IWebHostEnvironment env)
    {
        var sep = Path.DirectorySeparatorChar;
        foreach (var file in Directory.EnumerateFiles(env.ContentRootPath, "*.cs", SearchOption.AllDirectories))
        {
            if (file.Contains($"{sep}bin{sep}") || file.Contains($"{sep}obj{sep}")) continue;
            Parse(File.ReadAllLines(file));
        }
    }

    public string Get(params string[] names) =>
        string.Join("\n\n", names.Select(n => _snippets.GetValueOrDefault(n, $"// snippet '{n}' not found")));

    private void Parse(string[] lines)
    {
        string? name = null;
        List<string> buffer = [];
        foreach (var line in lines)
        {
            var t = line.Trim();
            if (t.StartsWith(Start)) { name = t[Start.Length..].Trim(); buffer = []; }
            else if (t == "// #endregion" && name is not null) { _snippets[name] = Dedent(buffer); name = null; }
            else if (name is not null) buffer.Add(line);
        }
    }

    private static string Dedent(List<string> lines)
    {
        var indent = lines.Where(l => l.Trim().Length > 0).Select(l => l.Length - l.TrimStart().Length).DefaultIfEmpty(0).Min();
        return string.Join('\n', lines.Select(l => l.Length >= indent ? l[indent..] : l.TrimStart()));
    }
}
