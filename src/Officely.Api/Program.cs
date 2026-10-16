using Officely.Api;
using Officely.Api.CaseStudies;

// Dev tooling for the case studies: switching one in the dev panel changes a DI registration and restarts
// the shop in-process, so a broken service graph fails exactly like a real deployment would.
var settings = new CaseStudySettings();
do
{
    settings.BeginStart();
    WebApplication app;
    try
    {
        app = await ShopHost.BuildAsync(args, settings);
    }
    catch (Exception ex)
    {
        app = ShopHost.BuildStartupFailure(args, settings, ex);
    }

    await app.RunAsync();
    await app.DisposeAsync();
}
while (settings.RestartRequested);
