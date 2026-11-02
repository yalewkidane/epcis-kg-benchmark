/**
 * E1-max – EPCIS capture of a MAXIMAL ObjectEvent (EPCIS alone, no resources needed).
 *
 * One test = one POST /capture of a generated EPCISDocument holding ONE ObjectEvent in
 * which every field the EPCIS 2.0 standard allows on an ObjectEvent is present:
 *   eventID, certificationInfo, eventTime, eventTimeZoneOffset, action, bizStep,
 *   disposition, persistentDisposition, epcList, quantityList, readPoint, bizLocation,
 *   bizTransactionList, sourceList, destinationList, sensorElementList (metadata and
 *   every report form: numeric with statistics, string, boolean, hex binary, URI,
 *   exception), ilmd, and user extensions (flat, nested, list).
 * Identifiers and event IDs never repeat: they carry a token unique per test and per run.
 *
 * Compare its TPS with EpcisCapture.groovy (a plain document) to see what full validation
 * and storage of a rich event cost. EPCS sets the number of items in epcList.
 * The repository stores every document, so reset DATA_DIR between repetitions.
 */
import static net.grinder.script.Grinder.grinder
import static org.junit.Assert.*
import static org.hamcrest.Matchers.*
import net.grinder.script.GTest
import net.grinder.scriptengine.groovy.junit.GrinderRunner
import net.grinder.scriptengine.groovy.junit.annotation.BeforeProcess
import net.grinder.scriptengine.groovy.junit.annotation.BeforeThread
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.ngrinder.http.HTTPRequest
import org.ngrinder.http.HTTPRequestControl
import org.ngrinder.http.HTTPResponse
import groovy.json.JsonOutput

@RunWith(GrinderRunner)
class EpcisCaptureMax {

    static final String EPCIS_URL = "http://localhost:7080/epcis/v2"
    // Items in epcList of the event (each one a unique SGTIN)
    static final int EPCS = 3

    static final String DL = "https://id.oliot.org"
    static final String EX = "https://example.org/epcis/max/"

    public static GTest test
    public static HTTPRequest request
    public static Map<String, String> headers = [:]
    // Distinguishes the identifiers of this run from those of earlier runs (epoch seconds)
    public static String runSalt = String.valueOf(System.currentTimeMillis().intdiv(1000))

    @BeforeProcess
    public static void beforeProcess() {
        HTTPRequestControl.setConnectionTimeout(30000)
        test = new GTest(1, "POST /capture (maximal ObjectEvent)")
        request = new HTTPRequest()
        headers = ["Content-Type": "application/json", "Accept": "application/json",
                   "GS1-EPCIS-Version": "2.0.0", "GS1-EPCIS-Max": "2.0.0", "GS1-EPCIS-Min": "2.0.0",
                   "GS1-CBV-Version": "2.0.0", "GS1-CBV-Max": "2.0.0", "GS1-CBV-Min": "2.0.0"]
        int bytes = JsonOutput.toJson(maximalDocument("sample")).bytes.length
        grinder.logger.info("maximal ObjectEvent document: {} EPCs, {} bytes, salt {}", EPCS, bytes, runSalt)
    }

    @BeforeThread
    public void beforeThread() {
        test.record(this, "test")
        grinder.statistics.delayReports = true
    }

    @Before
    public void before() {
        request.setHeaders(headers)
    }

    // ---------------------------------------------------------------- helpers
    static String isoNow() {
        return java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'")
                .format(java.time.ZonedDateTime.now(java.time.ZoneOffset.UTC))
    }

    /** Token that is unique per test within this run and differs between runs (digits only). */
    static String uniqueToken() {
        return runSalt + grinder.agentNumber + grinder.processNumber +
               String.format("%02d%06d", grinder.threadNumber, grinder.runNumber)
    }

    /** The ObjectEvent with every standard field populated; identifiers carry the token. */
    static Map maximalObjectEvent(String t, String now) {
        String device = DL + "/8004/0880002694SENSOR-" + t
        return [
            eventID: "urn:uuid:" + UUID.randomUUID().toString(),
            type: "ObjectEvent",
            certificationInfo: [EX + "cert/ISO-9001-" + t, EX + "cert/GDP-" + t],
            eventTime: now,
            eventTimeZoneOffset: "+00:00",
            action: "ADD",
            bizStep: "commissioning",
            disposition: "active",
            persistentDisposition: [set: ["completeness_verified"], unset: ["completeness_inferred"]],
            epcList: (1..EPCS).collect { DL + "/01/08800026940100/21/MAX-" + t + "-" + it },
            quantityList: [
                [epcClass: DL + "/01/08800026940200/10/LOT-" + t, quantity: 200, uom: "KGM"],
                [epcClass: DL + "/01/08800026940300/10/LOT-X-" + t, quantity: 50],
            ],
            readPoint: [id: DL + "/414/8800026940011"],
            bizLocation: [id: DL + "/414/8800026940022"],
            bizTransactionList: [
                [type: "po", bizTransaction: EX + "po/PO-" + t],
                [type: "inv", bizTransaction: EX + "invoice/INV-" + t],
                [type: "desadv", bizTransaction: EX + "asn/ASN-" + t],
                [type: "pedigree", bizTransaction: EX + "pedigree/PED-" + t],
            ],
            sourceList: [
                [type: "owning_party", source: DL + "/417/8800026940001"],
                [type: "possessing_party", source: DL + "/417/8800026940002"],
                [type: "location", source: DL + "/414/8800026940011"],
            ],
            destinationList: [
                [type: "owning_party", destination: DL + "/417/8800026940003"],
                [type: "possessing_party", destination: DL + "/417/8800026940004"],
                [type: "location", destination: DL + "/414/8800026940022"],
            ],
            sensorElementList: [
                [
                    sensorMetadata: [time: now, startTime: now, endTime: now, deviceID: device,
                                     deviceMetadata: EX + "device/thermometer-v3", rawData: EX + "raw/" + t + ".csv",
                                     dataProcessingMethod: EX + "method/avg-1min", bizRules: EX + "rules/cold-chain-v2"],
                    sensorReport: [
                        [type: "gs1:Temperature", value: 4.2, uom: "CEL", minValue: 3.8, maxValue: 4.9, meanValue: 4.3, sDev: 0.21,
                         percRank: 95, percValue: 4.8, time: now, deviceID: device, deviceMetadata: EX + "device/thermometer-v3",
                         rawData: EX + "raw/" + t + "-temp.csv", dataProcessingMethod: EX + "method/avg-1min",
                         component: EX + "component/core"],
                        [type: "gs1:RelativeHumidity", value: 61.5, uom: "A93", minValue: 58.0, maxValue: 64.0, time: now],
                        [type: "gs1:Pressure", value: 101.3, uom: "KPA", time: now],
                        [type: "gs1:Mass", value: 12.75, uom: "KGM", time: now],
                        [type: "gs1:Voltage", value: 3.65, uom: "VLT", time: now],
                        [type: "gs1:Length", value: 1.2, uom: "MTR", time: now],
                    ],
                    "example:sensorNote": "element 1 of " + t,
                ],
                [
                    sensorMetadata: [time: now, deviceID: DL + "/8004/0880002694GATEWAY-" + t],
                    sensorReport: [
                        [type: "gs1:Speed", stringValue: "stationary", time: now],
                        [type: "gs1:Illuminance", booleanValue: true, time: now],
                        [type: "gs1:Altitude", hexBinaryValue: "f0f0f0", time: now],
                        [type: "gs1:Count", uriValue: EX + "count/" + t, time: now],
                        [type: "gs1:Time", value: 15, uom: "MIN", exception: "ALARM_CONDITION", time: now],
                    ],
                ],
            ],
            ilmd: [
                "cbvmda:lotNumber": "LOT-" + t,
                "cbvmda:itemExpirationDate": "2027-12-31",
                "cbvmda:bestBeforeDate": "2027-06-30",
                "cbvmda:countryOfOrigin": "KR",
                "cbvmda:regulatedProductName": "Benchmark product",
                "example:batchAttributes": [colour: "navy", size: "L", weightKg: 0.42],
                "example:certified": true,
            ],
            "cbvmda:informationProvider": DL + "/417/8800026940001",
            "example:myField": "extension " + t,
            "example:nested": [level: 1, "example:inner": [level: 2, flag: true, values: [1, 2, 3]]],
            "example:tags": ["a", "b", "c"],
        ]
    }

    /** A maximal EPCISDocument with one ObjectEvent whose identifiers never repeat. */
    static Map maximalDocument(String token) {
        String now = isoNow()
        return ["@context": ["https://ref.gs1.org/standards/epcis/2.0.0/epcis-context.jsonld", [example: EX]],
                id: EX + "document/" + token,
                type: "EPCISDocument", schemaVersion: "2.0", creationDate: now,
                epcisHeader: ["example:documentNote": "benchmark document " + token],
                epcisBody: [eventList: [maximalObjectEvent(token, now)]]]
    }

    @Test
    public void test() {
        def doc = maximalDocument(uniqueToken())
        HTTPResponse response = request.POST(EPCIS_URL + "/capture", JsonOutput.toJson(doc).bytes)
        if (response.statusCode >= 300) {
            grinder.logger.warn("capture failed: {} {}", response.statusCode, response.getBodyText()?.take(300))
        }
        assertThat(response.statusCode, allOf(greaterThanOrEqualTo(200), lessThan(300)))
    }
}
