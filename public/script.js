document.getElementById("studentForm")
.addEventListener("submit", async function(e){

    e.preventDefault();

    const studentData = {

        firstName:
        document.getElementById("firstName").value,

        lastName:
        document.getElementById("lastName").value,

        domain:
        document.getElementById("domain").value,

        whatsapp:
        document.getElementById("whatsapp").value,

        email:
        document.getElementById("email").value,

        collegeName:
        document.getElementById("collegeName").value,

        tenure:
        document.getElementById("tenure").value,

        joiningDate:
        document.getElementById("joiningDate").value

    };

    try {

        const response = await fetch("/register", {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify(studentData)

        });

        const data = await response.json();

        if(data.success){

            alert(
                "Registration Successful\nEmployee ID: "
                + data.employeeId
            );

            document.getElementById("studentForm").reset();

        } else {

            alert(data.message);

        }

    } catch(err){

        console.log(err);

        alert("Registration Failed");

    }

});





document.getElementById("uploadExcelBtn")
.addEventListener("click", async () => {

    const fileInput =
    document.getElementById("excelFile");

    const file = fileInput.files[0];

    if (!file) {

        alert("Please choose Excel file");

        return;

    }

    const formData = new FormData();

    formData.append("excelFile", file);

    try {

        const response = await fetch("/upload-excel", {

            method: "POST",

            body: formData

        });

        const data = await response.json();

        if (data.success) {

            alert("Excel Uploaded Successfully");

        } else {

            alert(data.message);

        }

    } catch (err) {

        console.log(err);

        alert("Upload Failed");

    }

});
